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

export interface AssessmentLoadOptions {
  defaultCandidates?: readonly string[];
}

type ReadyAssessment = Extract<AssessmentLoadResult, { status: "ready" }>;

function defaultReportCandidates(): string[] {
  return [
    resolve(process.cwd(), "artifacts", "demo-hardening.json"),
    resolve(process.cwd(), "..", "..", "artifacts", "demo-hardening.json"),
    resolve(process.cwd(), "artifacts", "demo-assessment.json"),
    resolve(process.cwd(), "..", "..", "artifacts", "demo-assessment.json"),
  ];
}

function parseAssessment(raw: string, reportPath: string): ReadyAssessment | undefined {
  const parsed: unknown = JSON.parse(raw);
  const hardeningResult = Stage4HardeningReportSchema.safeParse(parsed);
  if (hardeningResult.success) {
    return {
      status: "ready",
      report: hardeningResult.data.baselineAssessment,
      hardeningReport: hardeningResult.data,
      reportPath,
    };
  }
  const result = DeterministicAssessmentReportSchema.safeParse(parsed);
  return result.success ? { status: "ready", report: result.data, reportPath } : undefined;
}

function freshness(result: ReadyAssessment): number {
  return Date.parse(result.hardeningReport?.generatedAt ?? result.report.generatedAt);
}

export async function loadAssessment(
  reportPath?: string,
  options: AssessmentLoadOptions = {},
): Promise<AssessmentLoadResult> {
  if (reportPath !== undefined) {
    const selectedPath = resolve(reportPath);
    try {
      const raw = await readFile(selectedPath, "utf8");
      const result = parseAssessment(raw, selectedPath);
      return result ?? {
        status: "invalid",
        message: "The assessment report failed schema validation and was not rendered.",
        reportPath: selectedPath,
      };
    } catch (error) {
      const code = error instanceof Error && "code" in error ? error.code : undefined;
      if (code === "ENOENT") {
        return {
          status: "missing",
          message: "No assessment report is available. Run the deterministic local assessment to populate this dashboard.",
        };
      }
      const message = error instanceof SyntaxError
        ? "The assessment report is not valid JSON and was not rendered."
        : "The assessment report could not be read.";
      return { status: "invalid", message, reportPath: selectedPath };
    }
  }

  const candidates = [...new Set(options.defaultCandidates ?? defaultReportCandidates())];
  const ready: Array<{ result: ReadyAssessment; priority: number }> = [];
  let invalidPath: string | undefined;
  for (const [priority, candidate] of candidates.entries()) {
    try {
      const raw = await readFile(candidate, "utf8");
      const result = parseAssessment(raw, candidate);
      if (result === undefined) {
        invalidPath ??= candidate;
      } else {
        ready.push({ result, priority });
      }
    } catch (error) {
      const code = error instanceof Error && "code" in error ? error.code : undefined;
      if (code !== "ENOENT") {
        invalidPath ??= candidate;
      }
    }
  }

  ready.sort((left, right) => freshness(right.result) - freshness(left.result) || left.priority - right.priority);
  if (ready[0] !== undefined) {
    return ready[0].result;
  }
  if (invalidPath !== undefined) {
    return {
      status: "invalid",
      message: "Available assessment artifacts were unreadable or failed validation.",
      reportPath: invalidPath,
    };
  }
  return {
    status: "missing",
    message: "No assessment report is available. Run the deterministic local assessment to populate this dashboard.",
  };
}
