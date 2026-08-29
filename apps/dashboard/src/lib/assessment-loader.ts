import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  DeterministicAssessmentReportSchema,
  Stage4HardeningReportSchema,
  type DeterministicAssessmentReport,
  type Stage4HardeningReport,
} from "@mcp-breaker/shared";

export type AssessmentLoadResult =
  | {
      status: "ready";
      report: DeterministicAssessmentReport;
      hardeningReport?: Stage4HardeningReport;
      reportPath: string;
    }
  | { status: "missing"; message: string }
  | { status: "invalid"; message: string; reportPath: string };

function defaultReportCandidates(): string[] {
  return [
    resolve(process.cwd(), "artifacts", "demo-hardening.json"),
    resolve(process.cwd(), "..", "..", "artifacts", "demo-hardening.json"),
    resolve(process.cwd(), "artifacts", "demo-assessment.json"),
    resolve(process.cwd(), "..", "..", "artifacts", "demo-assessment.json"),
  ];
}

export async function loadAssessment(reportPath?: string): Promise<AssessmentLoadResult> {
  const candidates = reportPath === undefined ? defaultReportCandidates() : [resolve(reportPath)];
  let selectedPath: string | undefined;
  let raw: string | undefined;

  for (const candidate of candidates) {
    try {
      raw = await readFile(candidate, "utf8");
      selectedPath = candidate;
      break;
    } catch (error) {
      const code = error instanceof Error && "code" in error ? error.code : undefined;
      if (code !== "ENOENT") {
        return { status: "invalid", message: "The assessment report could not be read.", reportPath: candidate };
      }
    }
  }

  if (raw === undefined || selectedPath === undefined) {
    return {
      status: "missing",
      message: "No assessment report is available. Run the deterministic local assessment to populate this dashboard.",
    };
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    const hardeningResult = Stage4HardeningReportSchema.safeParse(parsed);
    if (hardeningResult.success) {
      return {
        status: "ready",
        report: hardeningResult.data.baselineAssessment,
        hardeningReport: hardeningResult.data,
        reportPath: selectedPath,
      };
    }
    const result = DeterministicAssessmentReportSchema.safeParse(parsed);
    if (!result.success) {
      return {
        status: "invalid",
        message: "The assessment report failed schema validation and was not rendered.",
        reportPath: selectedPath,
      };
    }
    return { status: "ready", report: result.data, reportPath: selectedPath };
  } catch {
    return {
      status: "invalid",
      message: "The assessment report is not valid JSON and was not rendered.",
      reportPath: selectedPath,
    };
  }
}
