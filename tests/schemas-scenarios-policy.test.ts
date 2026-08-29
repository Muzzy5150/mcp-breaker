import {
  DETERMINISTIC_DEMO_SCENARIOS,
  SAFE_CONTROL_SCENARIOS,
  UNSAFE_DEMO_SCENARIOS,
} from "@mcp-breaker/attack-library";
import {
  compareToolPolicies,
  explainPolicyComparison,
  validateToolPolicy,
} from "@mcp-breaker/breaker-core";
import { DEMO_TOOL_METADATA } from "@mcp-breaker/demo-target";
import { ReplayResultSchema, TargetToolSchema, ToolPolicySchema } from "@mcp-breaker/shared";
import { describe, expect, it } from "vitest";

describe("safe deterministic scenarios", () => {
  it("defines one safe control and one unsafe TEST_FIXTURE for each initial category", () => {
    expect(DETERMINISTIC_DEMO_SCENARIOS).toHaveLength(8);
    expect(SAFE_CONTROL_SCENARIOS).toHaveLength(4);
    expect(UNSAFE_DEMO_SCENARIOS).toHaveLength(4);
    expect(new Set(SAFE_CONTROL_SCENARIOS.map((scenario) => scenario.category))).toEqual(
      new Set([
        "INDIRECT_PROMPT_INJECTION",
        "UNAUTHORIZED_WRITE",
        "DESTRUCTIVE_ACTION",
        "CONFUSED_DEPUTY",
      ]),
    );
    expect(new Set(UNSAFE_DEMO_SCENARIOS.map((scenario) => scenario.category))).toEqual(
      new Set(SAFE_CONTROL_SCENARIOS.map((scenario) => scenario.category)),
    );
    expect(DETERMINISTIC_DEMO_SCENARIOS.every((scenario) => scenario.provenance === "TEST_FIXTURE")).toBe(true);
  });

  it("rejects a reproduced replay without real trace linkage", () => {
    expect(
      ReplayResultSchema.safeParse({ status: "REPRODUCED", summary: "missing evidence" }).success,
    ).toBe(false);
  });

  it("rejects duplicate or contradictory tool risk classes", () => {
    const base = {
      name: "demo_tool",
      description: "Schema validation fixture.",
      approvalNormallyRequired: false,
      expectedAllowedContexts: ["Schema test"],
    };
    expect(TargetToolSchema.safeParse({ ...base, riskClasses: ["READ_ONLY", "READ_ONLY"] }).success).toBe(false);
    expect(TargetToolSchema.safeParse({ ...base, riskClasses: ["READ_ONLY", "WRITE"] }).success).toBe(false);
  });
});

describe("least-privilege policy model", () => {
  const current = ToolPolicySchema.parse({
    version: "1.0.0",
    defaultDisposition: "DENY",
    approvalStatus: "DRAFT",
    rules: [
      {
        toolName: "read_issue",
        disposition: "ALLOW",
        allowedContexts: ["Issue review"],
        rationale: "Read-only review tool.",
      },
      {
        toolName: "merge_pull_request",
        disposition: "REQUIRE_APPROVAL",
        allowedContexts: ["Explicit merge request"],
        rationale: "Destructive privileged operation.",
      },
    ],
  });

  it("validates known tools and rejects unknown or unconditional high-risk access", () => {
    expect(validateToolPolicy(current, [...DEMO_TOOL_METADATA]).valid).toBe(true);

    const unknown = structuredClone(current);
    unknown.rules.push({
      toolName: "real_github_delete",
      disposition: "ALLOW",
      allowedContexts: [],
      rationale: "Not a demo tool.",
    });
    expect(validateToolPolicy(unknown, [...DEMO_TOOL_METADATA])).toMatchObject({ valid: false });

    const unsafe = structuredClone(current);
    const mergeRule = unsafe.rules.find((rule) => rule.toolName === "merge_pull_request");
    if (mergeRule === undefined) {
      throw new Error("Expected merge policy rule.");
    }
    mergeRule.disposition = "ALLOW";
    mergeRule.allowedContexts = [];
    expect(validateToolPolicy(unsafe, [...DEMO_TOOL_METADATA])).toMatchObject({ valid: false });
  });

  it("compares policies and produces a human-readable explanation without applying them", () => {
    const proposed = ToolPolicySchema.parse({
      ...current,
      version: "1.1.0",
      rules: current.rules.map((rule) =>
        rule.toolName === "merge_pull_request"
          ? { ...rule, disposition: "DENY" as const, allowedContexts: [] }
          : rule,
      ),
    });
    const differences = compareToolPolicies(current, proposed);

    expect(differences).toHaveLength(1);
    expect(differences[0]).toMatchObject({
      toolName: "merge_pull_request",
      currentDisposition: "REQUIRE_APPROVAL",
      proposedDisposition: "DENY",
    });
    expect(explainPolicyComparison(differences)).toContain("changes from REQUIRE_APPROVAL to DENY");
  });

  it("requires explicit human metadata before a policy can be APPROVED", () => {
    expect(
      ToolPolicySchema.safeParse({ ...current, approvalStatus: "APPROVED" }).success,
    ).toBe(false);
    expect(
      ToolPolicySchema.safeParse({
        ...current,
        approvalStatus: "APPROVED",
        approvedBy: "demo-reviewer",
        approvedAt: "2026-08-29T12:00:00.000Z",
      }).success,
    ).toBe(true);
  });
});
