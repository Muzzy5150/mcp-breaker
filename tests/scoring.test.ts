import { DEMO_TOOL_METADATA } from "@mcp-breaker/demo-target";
import { scoreSecurityAssessment } from "@mcp-breaker/scoring";
import { describe, expect, it } from "vitest";

import { createFinding } from "./helpers.js";

describe("deterministic security scoring", () => {
  it("scores only verified RUNTIME findings using documented severity deductions", () => {
    const assessment = scoreSecurityAssessment({
      findings: [
        createFinding({ id: "finding-high-one", targetTool: "merge_pull_request", severity: "HIGH" }),
        createFinding({ id: "finding-low-one", targetTool: "write_file", severity: "LOW" }),
        createFinding({
          id: "finding-unverified-one",
          targetTool: "delete_file",
          severity: "CRITICAL",
          replayStatus: "INCONCLUSIVE",
        }),
        createFinding({
          id: "finding-test-fixture-one",
          targetTool: "send_message",
          severity: "CRITICAL",
          provenance: "TEST_FIXTURE",
        }),
      ],
      targetTools: [...DEMO_TOOL_METADATA],
      assessedAt: "2026-08-29T12:00:00.000Z",
    });

    expect(assessment.score).toBe(75);
    expect(assessment.findingCounts).toEqual({ INFO: 0, LOW: 1, MEDIUM: 0, HIGH: 1, CRITICAL: 0 });
    expect(assessment.findingIds).toEqual(["finding-high-one", "finding-low-one"]);
    expect(
      assessment.toolRiskSummary.find((summary) => summary.toolName === "merge_pull_request"),
    ).toMatchObject({ verifiedFindingCount: 1, highestSeverity: "HIGH", deductedPoints: 20 });
  });

  it("returns 100 when no verified runtime findings are supplied", () => {
    const assessment = scoreSecurityAssessment({
      findings: [],
      targetTools: [...DEMO_TOOL_METADATA],
      assessedAt: "2026-08-29T12:00:00.000Z",
    });
    expect(assessment.score).toBe(100);
    expect(assessment.findingIds).toEqual([]);
  });

  it("floors the score at zero and rejects duplicate finding IDs", () => {
    const findings = [
      createFinding({ id: "finding-critical-a", targetTool: "merge_pull_request", severity: "CRITICAL" }),
      createFinding({ id: "finding-critical-b", targetTool: "delete_file", severity: "CRITICAL" }),
      createFinding({ id: "finding-critical-c", targetTool: "send_message", severity: "CRITICAL" }),
    ];
    expect(
      scoreSecurityAssessment({
        findings,
        targetTools: [...DEMO_TOOL_METADATA],
        assessedAt: "2026-08-29T12:00:00.000Z",
      }).score,
    ).toBe(0);

    expect(() =>
      scoreSecurityAssessment({
        findings: [findings[0]!, findings[0]!],
        targetTools: [...DEMO_TOOL_METADATA],
        assessedAt: "2026-08-29T12:00:00.000Z",
      }),
    ).toThrow("Duplicate finding ID");
  });

  it("rejects verified findings for unknown tools", () => {
    expect(() =>
      scoreSecurityAssessment({
        findings: [
          createFinding({ id: "finding-unknown-tool", targetTool: "unknown_tool", severity: "HIGH" }),
        ],
        targetTools: [...DEMO_TOOL_METADATA],
        assessedAt: "2026-08-29T12:00:00.000Z",
      }),
    ).toThrow("Verified finding references unknown target tool");
  });

  it("rejects duplicate target-tool metadata", () => {
    const duplicate = DEMO_TOOL_METADATA[0]!;
    expect(() =>
      scoreSecurityAssessment({
        findings: [],
        targetTools: [...DEMO_TOOL_METADATA, duplicate],
        assessedAt: "2026-08-29T12:00:00.000Z",
      }),
    ).toThrow("Duplicate target tool");
  });
});
