import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { DETERMINISTIC_DEMO_SCENARIOS } from "@mcp-breaker/attack-library";
import { DEMO_TOOL_METADATA } from "@mcp-breaker/demo-target";
import { runAssessment } from "@mcp-breaker/evaluation";
import {
  DeterministicAssessmentReportSchema,
  type DeterministicAssessmentReport,
} from "@mcp-breaker/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";

import { AssessmentState } from "../apps/dashboard/src/components/assessment-state.js";
import { SecurityDashboard } from "../apps/dashboard/src/components/security-dashboard.js";
import { NeonRGBTextEffect } from "../apps/dashboard/src/components/ui/neon-rgbtext-effect.js";
import { buildRiskMatrix } from "../apps/dashboard/src/lib/dashboard-data.js";
import { loadAssessment } from "../apps/dashboard/src/lib/assessment-loader.js";

let report: DeterministicAssessmentReport;
let dashboardHtml: string;

beforeAll(async () => {
  report = await runAssessment();
  dashboardHtml = renderToStaticMarkup(<SecurityDashboard report={report} />);
});

describe("Stage 3 dashboard rendering", () => {
  it("renders reusable MCP branding with an accessible text fallback", () => {
    const html = renderToStaticMarkup(<NeonRGBTextEffect text="MCP BREAKER" />);
    expect(html).toContain("MCP BREAKER");
    expect(html).toContain("neon-rgb-text-fallback");
    expect(html).toContain("aria-hidden=\"true\"");
  });

  it("renders a schema-validated Stage 2 assessment and its actual score", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mcp-breaker-dashboard-valid-"));
    const reportPath = join(directory, "assessment.json");
    await writeFile(reportPath, JSON.stringify(report), "utf8");
    const loaded = await loadAssessment(reportPath);

    expect(loaded.status).toBe("ready");
    expect(dashboardHtml).toContain(`Security score ${report.securityAssessment.score} out of 100`);
    expect(dashboardHtml).toContain(`>${report.securityAssessment.score}<`);
  });

  it("renders finding and severity counts from the assessment", () => {
    expect(dashboardHtml).toContain(`${report.verifiedFindings.length} verified`);
    expect(dashboardHtml).toContain(`>${report.securityAssessment.findingCounts.CRITICAL}<`);
    expect(dashboardHtml).toContain(`>${report.securityAssessment.findingCounts.HIGH}<`);
    expect(dashboardHtml).toContain(`>${report.securityAssessment.findingCounts.MEDIUM}<`);
  });

  it("renders every tool from the Stage 1 metadata source", () => {
    for (const tool of DEMO_TOOL_METADATA) {
      expect(dashboardHtml).toContain(tool.name);
      expect(dashboardHtml).toContain(tool.riskClasses[0]);
    }
  });

  it("renders actual finding details and distinct original/replay evidence", () => {
    for (const finding of report.verifiedFindings) {
      expect(dashboardHtml).toContain(finding.originalUserIntent);
      expect(dashboardHtml).toContain(finding.untrustedContent);
      expect(dashboardHtml).toContain(finding.evidence.executionTraceId);
      expect(dashboardHtml).toContain(finding.evidence.replayExecutionTraceId);
      expect(finding.evidence.executionTraceId).not.toBe(finding.evidence.replayExecutionTraceId);
    }
    expect(dashboardHtml).toContain("Distinct trace, same prohibited action");
  });

  it("renders all four safe control scenarios with observed PASS behavior", () => {
    const safeControls = DETERMINISTIC_DEMO_SCENARIOS.filter(
      (scenario) => scenario.controlType === "SAFE_CONTROL",
    );
    expect(safeControls).toHaveLength(4);
    for (const scenario of safeControls) {
      expect(dashboardHtml).toContain(scenario.title);
    }
    expect(dashboardHtml).toContain("4 passed");
  });

  it("marks a matrix cell FAIL only when a verified finding matches the tool and category", () => {
    const rows = buildRiskMatrix(report, DEMO_TOOL_METADATA);
    const deleteRow = rows.find((row) => row.tool.name === "delete_file");
    const readRow = rows.find((row) => row.tool.name === "read_issue");
    expect(deleteRow?.statuses.DESTRUCTIVE_ACTION).toBe("FAIL");
    expect(readRow?.statuses.INDIRECT_PROMPT_INJECTION).toBe("PASS");
    expect(readRow?.statuses.CONFUSED_DEPUTY).toBe("NOT_TESTED");
  });

  it("renders an explicit zero-findings state", () => {
    const zeroReport = DeterministicAssessmentReportSchema.parse({
      ...report,
      verifiedFindings: [],
      securityAssessment: {
        ...report.securityAssessment,
        score: 100,
        findingCounts: { INFO: 0, LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 },
        findingIds: [],
      },
    });
    const html = renderToStaticMarkup(<SecurityDashboard report={zeroReport} />);
    expect(html).toContain("No verified findings");
  });
});

describe("assessment loader states", () => {
  it("returns and renders a missing-assessment state", async () => {
    const result = await loadAssessment(join(tmpdir(), "mcp-breaker-report-does-not-exist.json"));
    expect(result.status).toBe("missing");
    if (result.status === "missing") {
      expect(renderToStaticMarkup(<AssessmentState result={result} />)).toContain("Assessment not yet run");
    }
  });

  it("returns and renders an invalid-assessment state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mcp-breaker-dashboard-invalid-"));
    const reportPath = join(directory, "assessment.json");
    await writeFile(reportPath, JSON.stringify({ score: 15 }), "utf8");
    const result = await loadAssessment(reportPath);
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(renderToStaticMarkup(<AssessmentState result={result} />)).toContain("Assessment report invalid");
    }
  });
});
