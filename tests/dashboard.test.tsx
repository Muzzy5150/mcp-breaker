import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { DETERMINISTIC_DEMO_SCENARIOS } from "@mcp-breaker/attack-library";
import { DEMO_TOOL_METADATA } from "@mcp-breaker/demo-target";
import { runAssessment, runHardeningAssessment } from "@mcp-breaker/evaluation";
import {
  DeterministicAssessmentReportSchema,
  type DeterministicAssessmentReport,
  type Stage4HardeningReport,
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
let hardeningReport: Stage4HardeningReport;
let hardeningHtml: string;

beforeAll(async () => {
  report = await runAssessment();
  dashboardHtml = renderToStaticMarkup(<SecurityDashboard report={report} />);
  hardeningReport = await runHardeningAssessment();
  hardeningHtml = renderToStaticMarkup(
    <SecurityDashboard report={hardeningReport.baselineAssessment} hardeningReport={hardeningReport} />,
  );
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

  it("renders the real assessment inside the adapted product hero", () => {
    expect(dashboardHtml).toContain("Test every tool call.");
    expect(dashboardHtml).toContain("Verify every failure.");
    expect(dashboardHtml).toContain(report.runId);
    expect(dashboardHtml).toContain("Demo Developer Agent");
    expect(dashboardHtml).toContain("bento-card bento-card-featured score-panel");
  });

  it("renders finding and severity counts from the assessment", () => {
    expect(dashboardHtml).toContain(`${report.verifiedFindings.length} verified`);
    expect(dashboardHtml).toContain(`>${report.securityAssessment.findingCounts.CRITICAL}<`);
    expect(dashboardHtml).toContain(`>${report.securityAssessment.findingCounts.HIGH}<`);
    expect(dashboardHtml).toContain(`>${report.securityAssessment.findingCounts.MEDIUM}<`);
  });

  it("renders every tool from the Stage 1 metadata source", () => {
    expect(dashboardHtml).toContain("class=\"tool-grid\"");
    expect(dashboardHtml).toContain("class=\"bento-card tool-card");
    expect(dashboardHtml).toContain("bento-card-featured tool-card-affected");
    for (const tool of DEMO_TOOL_METADATA) {
      expect(dashboardHtml).toContain(tool.name);
      expect(dashboardHtml).toContain(tool.riskClasses[0]);
    }
  });

  it("renders actual finding details and distinct original/replay evidence", () => {
    expect(dashboardHtml).toContain("management-table-shell management-table-danger finding-list");
    expect(dashboardHtml).toContain("Verified runtime findings");
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
    expect(dashboardHtml).toContain("4 of 4 passed");
    expect(dashboardHtml).not.toContain("safe-card-nonpass");
  });

  it("counts and styles only actual PASS executions as safe controls", () => {
    const failedControlId = DETERMINISTIC_DEMO_SCENARIOS.find(
      (scenario) => scenario.controlType === "SAFE_CONTROL",
    )?.id;
    const degradedReport = DeterministicAssessmentReportSchema.parse({
      ...report,
      executions: report.executions.map((execution) =>
        execution.scenarioId === failedControlId && execution.replayOfExecutionId === undefined
          ? {
              ...execution,
              evaluation: {
                status: "EXECUTION_ERROR",
                summary: "The control execution failed.",
                violations: [],
              },
            }
          : execution,
      ),
    });
    const html = renderToStaticMarkup(<SecurityDashboard report={degradedReport} />);

    expect(html).toContain("3 of 4 passed");
    expect(html).toContain("safe-card-nonpass");
    expect(html).toContain("safe-status-nonpass");
    expect(html).toContain("EXECUTION ERROR");
    expect(html).not.toContain("4 of 4 passed");
  });

  it("marks a matrix cell FAIL only when a verified finding matches the tool and category", () => {
    const rows = buildRiskMatrix(report, DEMO_TOOL_METADATA);
    const deleteRow = rows.find((row) => row.tool.name === "delete_file");
    const readRow = rows.find((row) => row.tool.name === "read_issue");
    expect(deleteRow?.statuses.DESTRUCTIVE_ACTION).toBe("FAIL");
    expect(readRow?.statuses.INDIRECT_PROMPT_INJECTION).toBe("PASS");
    expect(readRow?.statuses.CONFUSED_DEPUTY).toBe("NOT_TESTED");
  });

  it.each([
    ["CANDIDATE_FINDING", "CANDIDATE"],
    ["INCONCLUSIVE", "INCONCLUSIVE"],
    ["EXECUTION_ERROR", "ERROR"],
  ] as const)("does not present a %s execution as PASS coverage", (evaluationStatus, matrixStatus) => {
    const targetTool = "merge_pull_request";
    const targetExecution = report.executions.find(
      (execution) =>
        execution.replayOfExecutionId === undefined &&
        execution.trace.steps.some((step) => step.toolName === targetTool),
    );
    expect(targetExecution).toBeDefined();
    const degradedReport = DeterministicAssessmentReportSchema.parse({
      ...report,
      verifiedFindings: [],
      executions: report.executions.map((execution) =>
        execution.executionId === targetExecution?.executionId
          ? {
              ...execution,
              evaluation: {
                status: evaluationStatus,
                summary: `Deliberate ${evaluationStatus} matrix fixture.`,
                violations: [],
              },
            }
          : execution,
      ),
    });
    const row = buildRiskMatrix(degradedReport, DEMO_TOOL_METADATA).find(
      (candidate) => candidate.tool.name === targetTool,
    );

    expect(row?.statuses.INDIRECT_PROMPT_INJECTION).toBe(matrixStatus);
    expect(row?.statuses.INDIRECT_PROMPT_INJECTION).not.toBe("PASS");
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

  it("renders measured Stage 4 hardening outcomes without claiming approval or TrueForge application", () => {
    expect(hardeningHtml).toContain("Before / After Policy Hardening");
    expect(hardeningHtml).toContain("15<small>/100</small>");
    expect(hardeningHtml).toContain("100<small>/100</small>");
    expect(hardeningHtml).toContain("4 remediated");
    expect(hardeningHtml).toContain("Not approved · Not applied to TrueForge");
    expect(hardeningHtml).toContain("Finding-by-finding evidence");
    for (const result of hardeningReport.remediationResults) {
      expect(hardeningHtml).toContain(result.affectedTool);
      expect(hardeningHtml).toContain(result.after.retestTraceId);
    }
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

  it("loads a schema-validated Stage 4 artifact and exposes its baseline for the unchanged dashboard", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mcp-breaker-dashboard-hardening-"));
    const reportPath = join(directory, "hardening.json");
    await writeFile(reportPath, JSON.stringify(hardeningReport), "utf8");
    const result = await loadAssessment(reportPath);
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.report.runId).toBe(hardeningReport.baselineAssessment.runId);
      expect(result.hardeningReport?.runId).toBe(hardeningReport.runId);
    }
  });

  it("selects the freshest valid default artifact instead of a stale hardening report", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mcp-breaker-dashboard-freshness-"));
    const hardeningPath = join(directory, "demo-hardening.json");
    const assessmentPath = join(directory, "demo-assessment.json");
    const staleHardening = { ...structuredClone(hardeningReport), generatedAt: "2026-01-01T00:00:00.000Z" };
    const freshAssessment = {
      ...structuredClone(report),
      runId: "assessment-fresh-default",
      generatedAt: "2026-01-02T00:00:00.000Z",
    };
    await writeFile(hardeningPath, JSON.stringify(staleHardening), "utf8");
    await writeFile(assessmentPath, JSON.stringify(freshAssessment), "utf8");

    const result = await loadAssessment(undefined, { defaultCandidates: [hardeningPath, assessmentPath] });

    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.report.runId).toBe("assessment-fresh-default");
      expect(result.hardeningReport).toBeUndefined();
      expect(result.reportPath).toBe(assessmentPath);
    }
  });

  it("falls through malformed and schema-invalid default artifacts to a valid assessment", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mcp-breaker-dashboard-fallback-"));
    const malformedPath = join(directory, "malformed-hardening.json");
    const invalidPath = join(directory, "invalid-hardening.json");
    const assessmentPath = join(directory, "demo-assessment.json");
    await writeFile(malformedPath, "{partial", "utf8");
    await writeFile(invalidPath, JSON.stringify({ reportVersion: "2.0.0" }), "utf8");
    await writeFile(assessmentPath, JSON.stringify(report), "utf8");

    const result = await loadAssessment(undefined, {
      defaultCandidates: [malformedPath, invalidPath, assessmentPath],
    });

    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.report.runId).toBe(report.runId);
      expect(result.reportPath).toBe(assessmentPath);
    }
  });
});
