import {
  DETERMINISTIC_DEMO_SCENARIOS,
  SAFE_CONTROL_SCENARIOS,
  getDeterministicDemoScenario,
} from "@mcp-breaker/attack-library";
import {
  TraceRecorder,
  deriveCurrentDemoPolicy,
  generateRemediationPolicy,
  validateToolPolicy,
} from "@mcp-breaker/breaker-core";
import { DEMO_TOOL_METADATA, DemoStateStore, DemoToolService } from "@mcp-breaker/demo-target";
import {
  DeterministicExecutionAdapter,
  PolicyEnforcedExecutionAdapter,
  ScenarioRunner,
  runAssessment,
  runHardeningAssessment,
} from "@mcp-breaker/evaluation";
import { Stage4HardeningReportSchema, type ToolPolicy } from "@mcp-breaker/shared";
import { describe, expect, it } from "vitest";

import { DeterministicClock, DeterministicIds } from "./helpers.js";

function deterministicHarness(): {
  adapter: DeterministicExecutionAdapter;
  clock: DeterministicClock;
  ids: DeterministicIds;
} {
  const clock = new DeterministicClock();
  const ids = new DeterministicIds();
  const store = new DemoStateStore(() => clock.now());
  const traces = new TraceRecorder(clock, ids);
  return { adapter: new DeterministicExecutionAdapter(new DemoToolService(store, traces)), clock, ids };
}

function withDisposition(policy: ToolPolicy, toolName: string, disposition: ToolPolicy["defaultDisposition"]): ToolPolicy {
  return {
    ...structuredClone(policy),
    approvalStatus: "PROPOSED",
    rules: policy.rules.map((rule) =>
      rule.toolName === toolName
        ? {
            ...rule,
            disposition,
            rationale: `Test policy sets ${toolName} to ${disposition}.`,
          }
        : rule,
    ),
  };
}

describe("Stage 4 policy generation", () => {
  it("derives a truthful current policy and a least-privilege proposal from runtime findings", async () => {
    const baselineHarness = deterministicHarness();
    const baseline = await runAssessment(undefined, baselineHarness);
    const current = deriveCurrentDemoPolicy(DEMO_TOOL_METADATA);
    const generated = generateRemediationPolicy({
      currentPolicy: current,
      findings: baseline.verifiedFindings,
      tools: DEMO_TOOL_METADATA,
    });

    expect(validateToolPolicy(current, [...DEMO_TOOL_METADATA]).valid).toBe(true);
    expect(validateToolPolicy(generated.proposedPolicy, [...DEMO_TOOL_METADATA]).valid).toBe(true);
    expect(current.approvalStatus).toBe("DRAFT");
    expect(generated.proposedPolicy.approvalStatus).toBe("PROPOSED");
    expect(generated.proposedPolicy.approvedBy).toBeUndefined();
    expect(generated.proposedPolicy.rules).toHaveLength(DEMO_TOOL_METADATA.length);
    expect(generated.proposedPolicy.rules.some((rule) => rule.disposition === "ALLOW")).toBe(true);
    expect(
      generated.proposedPolicy.rules
        .filter((rule) => ["read_issue", "read_file", "list_files"].includes(rule.toolName))
        .every((rule) => rule.disposition === "ALLOW"),
    ).toBe(true);

    for (const finding of baseline.verifiedFindings) {
      const provenance = generated.provenance.find((entry) => entry.toolName === finding.targetTool);
      expect(provenance?.relatedFindingIds).toContain(finding.stableId);
      expect(provenance?.changed).toBe(true);
    }
  });

  it("rejects malformed and unknown-tool policies before enforcement", () => {
    const malformed = {
      version: "2.0.0",
      defaultDisposition: "DENY",
      approvalStatus: "PROPOSED",
      rules: [
        { toolName: "not_a_demo_tool", disposition: "ALLOW", allowedContexts: ["Never."], rationale: "Invalid." },
      ],
    };
    expect(validateToolPolicy(malformed, [...DEMO_TOOL_METADATA]).valid).toBe(false);
    expect(() => new PolicyEnforcedExecutionAdapter(new DeterministicExecutionAdapter(), malformed, DEMO_TOOL_METADATA)).toThrow(
      /invalid/i,
    );
  });
});

describe("Stage 4 enforcement semantics", () => {
  it("allows authorized read-only work and records the correlated policy decision", async () => {
    const harness = deterministicHarness();
    const policy = withDisposition(deriveCurrentDemoPolicy(DEMO_TOOL_METADATA), "read_issue", "ALLOW");
    const enforced = new PolicyEnforcedExecutionAdapter(harness.adapter, policy, DEMO_TOOL_METADATA, {
      clock: harness.clock,
      ids: harness.ids,
    });
    const execution = await new ScenarioRunner(enforced, harness.clock, harness.ids).runScenario(
      getDeterministicDemoScenario("scenario-indirect-issue-42-safe"),
    );

    expect(execution.evaluation.status).toBe("PASS");
    expect(enforced.decisions).toMatchObject([
      { traceId: execution.traceId, toolName: "read_issue", decision: "ALLOWED", executed: true },
    ]);
  });

  it("blocks DENY and unknown tools closed without invoking the underlying adapter", async () => {
    const harness = deterministicHarness();
    const policy = withDisposition(deriveCurrentDemoPolicy(DEMO_TOOL_METADATA), "send_message", "DENY");
    const enforced = new PolicyEnforcedExecutionAdapter(harness.adapter, policy, DEMO_TOOL_METADATA, {
      clock: harness.clock,
      ids: harness.ids,
    });
    const execution = await new ScenarioRunner(enforced, harness.clock, harness.ids).runScenario(
      getDeterministicDemoScenario("scenario-confused-deputy-unsafe"),
    );
    expect(execution.evaluation.status).toBe("PASS");
    expect(execution.observedBehavior.stateChanged).toBe(false);
    expect(enforced.decisions.find((decision) => decision.toolName === "send_message")).toMatchObject({
      decision: "BLOCKED",
      executed: false,
    });

    const traceId = "trace-unknown-tool";
    await enforced.reset();
    await enforced.beginExecution({
      runId: "run-unknown",
      scenarioId: "scenario-unknown",
      executionId: "execution-unknown",
      traceId,
    });
    await expect(
      enforced.executeStep({ id: "step-unknown-tool", toolName: "unknown_tool", arguments: {} }, traceId),
    ).resolves.toMatchObject({ decision: "BLOCKED", executed: false });
    expect(enforced.decisions.at(-1)).toMatchObject({
      toolName: "unknown_tool",
      effectiveDisposition: "DENY",
      decision: "BLOCKED",
    });
  });

  it("requires an approval grant that matches the exact scenario, step, and tool", async () => {
    const blockedHarness = deterministicHarness();
    const policy = withDisposition(deriveCurrentDemoPolicy(DEMO_TOOL_METADATA), "write_file", "REQUIRE_APPROVAL");
    const blocked = new PolicyEnforcedExecutionAdapter(blockedHarness.adapter, policy, DEMO_TOOL_METADATA, {
      clock: blockedHarness.clock,
      ids: blockedHarness.ids,
    });
    const scenario = getDeterministicDemoScenario("scenario-unauthorized-write-unsafe");
    const blockedExecution = await new ScenarioRunner(blocked, blockedHarness.clock, blockedHarness.ids).runScenario(scenario);
    expect(blockedExecution.observedBehavior.stateChanged).toBe(false);
    expect(blocked.decisions.find((decision) => decision.toolName === "write_file")).toMatchObject({
      decision: "APPROVAL_REQUIRED",
      executed: false,
      approvalRequired: true,
      approvalSupplied: false,
    });

    const approvedHarness = deterministicHarness();
    const approved = new PolicyEnforcedExecutionAdapter(approvedHarness.adapter, policy, DEMO_TOOL_METADATA, {
      clock: approvedHarness.clock,
      ids: approvedHarness.ids,
      approvals: [
        {
          scenarioId: scenario.id,
          stepId: "step-write-report",
          toolName: "write_file",
        },
      ],
    });
    const approvedExecution = await new ScenarioRunner(approved, approvedHarness.clock, approvedHarness.ids).runScenario(scenario);
    expect(approvedExecution.evaluation.status).toBe("CANDIDATE_FINDING");
    expect(approvedExecution.observedBehavior.stateChanged).toBe(true);
    expect(approved.decisions.find((decision) => decision.toolName === "write_file")).toMatchObject({
      decision: "ALLOWED",
      executed: true,
      approvalSupplied: true,
    });
  });

  it("enforces the declared local sandbox boundary for SANDBOX_ONLY", async () => {
    const policy = withDisposition(deriveCurrentDemoPolicy(DEMO_TOOL_METADATA), "read_file", "SANDBOX_ONLY");
    const scenario = getDeterministicDemoScenario("scenario-unauthorized-write-safe");

    const outsideHarness = deterministicHarness();
    const outside = new PolicyEnforcedExecutionAdapter(outsideHarness.adapter, policy, DEMO_TOOL_METADATA, {
      clock: outsideHarness.clock,
      ids: outsideHarness.ids,
      sandboxSatisfied: false,
    });
    await new ScenarioRunner(outside, outsideHarness.clock, outsideHarness.ids).runScenario(scenario);
    expect(outside.decisions[0]).toMatchObject({ decision: "SANDBOX_REQUIRED", executed: false });

    const insideHarness = deterministicHarness();
    const inside = new PolicyEnforcedExecutionAdapter(insideHarness.adapter, policy, DEMO_TOOL_METADATA, {
      clock: insideHarness.clock,
      ids: insideHarness.ids,
      sandboxSatisfied: true,
    });
    await new ScenarioRunner(inside, insideHarness.clock, insideHarness.ids).runScenario(scenario);
    expect(inside.decisions[0]).toMatchObject({ decision: "ALLOWED", executed: true });
  });
});

describe("Stage 4 hardened retest", () => {
  it("retests the same suite, preserves safe behavior, and proves all baseline findings remediated", async () => {
    const harness = deterministicHarness();
    const report = await runHardeningAssessment(DETERMINISTIC_DEMO_SCENARIOS, harness);

    expect(Stage4HardeningReportSchema.safeParse(JSON.parse(JSON.stringify(report))).success).toBe(true);
    expect(report.baselineAssessment.securityAssessment.score).toBe(15);
    expect(report.postHardeningAssessment.securityAssessment.score).toBe(100);
    expect(report.baselineAssessment.verifiedFindings).toHaveLength(4);
    expect(report.postHardeningAssessment.verifiedFindings).toHaveLength(0);
    expect(report.remediationResults).toHaveLength(4);
    expect(report.remediationResults.every((result) => result.status === "REMEDIATED")).toBe(true);
    expect(report.remediationResults.every((result) => result.stateMutationPrevented)).toBe(true);
    expect(new Set(report.remediationResults.map((result) => result.originalSeverity))).toEqual(
      new Set(["MEDIUM", "HIGH", "CRITICAL"]),
    );
    expect(new Set(report.remediationResults.map((result) => result.affectedTool))).toEqual(
      new Set(["merge_pull_request", "write_file", "delete_file", "send_message"]),
    );
    for (const safeScenario of SAFE_CONTROL_SCENARIOS) {
      const execution = report.postHardeningAssessment.executions.find(
        (candidate) => candidate.scenarioId === safeScenario.id && candidate.replayOfExecutionId === undefined,
      );
      expect(execution?.evaluation.status).toBe("PASS");
    }
    expect(report.trueForgeIntegrated).toBe(false);
    expect(report.policyAppliedToTrueForge).toBe(false);
  });

  it("reports NOT_REMEDIATED when a supplied policy leaves a reproduced unsafe tool allowed", async () => {
    const seedHarness = deterministicHarness();
    const baseline = await runAssessment(undefined, seedHarness);
    const current = deriveCurrentDemoPolicy(DEMO_TOOL_METADATA);
    const generated = generateRemediationPolicy({
      currentPolicy: current,
      findings: baseline.verifiedFindings,
      tools: DEMO_TOOL_METADATA,
    });
    const insufficientPolicy = withDisposition(generated.proposedPolicy, "send_message", "ALLOW");
    const harness = deterministicHarness();
    const report = await runHardeningAssessment(
      [getDeterministicDemoScenario("scenario-confused-deputy-unsafe")],
      { ...harness, proposedPolicyOverride: insufficientPolicy },
    );

    expect(report.postHardeningAssessment.verifiedFindings).toHaveLength(1);
    expect(report.remediationResults).toMatchObject([
      {
        affectedTool: "send_message",
        status: "NOT_REMEDIATED",
        stateMutationPrevented: false,
        after: { toolExecuted: true, stateMutationOccurred: true },
      },
    ]);
  });
});
