import { randomIdGenerator, systemClock, validatePolicyOrThrow, type Clock, type IdGenerator } from "@mcp-breaker/breaker-core";
import {
  PolicyDecisionEvidenceSchema,
  type PolicyDecisionEvidence,
  type PolicyDecisionOutcome,
  type PolicyDisposition,
  type ScriptedToolStep,
  type TargetTool,
  type ToolPolicy,
  type ToolPolicyRule,
} from "@mcp-breaker/shared";

import type { ExecutionAdapter, ExecutionCorrelation } from "./adapter.js";

export interface PolicyApprovalGrant {
  scenarioId: string;
  stepId: string;
  toolName: string;
}

export interface PolicyEnforcementOptions {
  sandboxSatisfied?: boolean;
  approvals?: readonly PolicyApprovalGrant[];
  clock?: Clock;
  ids?: IdGenerator;
}

export interface PolicyBlockedToolResult {
  policyEnforced: true;
  executed: false;
  decision: Exclude<PolicyDecisionOutcome, "ALLOWED">;
  toolName: string;
}

function blockedResult(
  decision: Exclude<PolicyDecisionOutcome, "ALLOWED">,
  toolName: string,
): PolicyBlockedToolResult {
  return { policyEnforced: true, executed: false, decision, toolName };
}

export class PolicyEnforcedExecutionAdapter<State = unknown> implements ExecutionAdapter<State> {
  readonly executionMode = "DETERMINISTIC_TEST" as const;
  readonly #adapter: ExecutionAdapter<State>;
  readonly #policy: ToolPolicy;
  readonly #tools: Map<string, TargetTool>;
  readonly #sandboxSatisfied: boolean;
  readonly #approvals: readonly PolicyApprovalGrant[];
  readonly #clock: Clock;
  readonly #ids: IdGenerator;
  readonly #correlations = new Map<string, ExecutionCorrelation>();
  readonly #decisions: PolicyDecisionEvidence[] = [];

  constructor(
    adapter: ExecutionAdapter<State>,
    rawPolicy: unknown,
    targetTools: readonly TargetTool[],
    options: PolicyEnforcementOptions = {},
  ) {
    this.#adapter = adapter;
    this.#policy = validatePolicyOrThrow(rawPolicy, targetTools, "Policy enforcement");
    this.#tools = new Map(targetTools.map((tool) => [tool.name, tool]));
    this.#sandboxSatisfied = options.sandboxSatisfied ?? false;
    this.#approvals = options.approvals ?? [];
    this.#clock = options.clock ?? systemClock;
    this.#ids = options.ids ?? randomIdGenerator;
  }

  get policy(): ToolPolicy {
    return structuredClone(this.#policy);
  }

  get decisions(): readonly PolicyDecisionEvidence[] {
    return structuredClone(this.#decisions);
  }

  reset(): Promise<State> {
    return this.#adapter.reset();
  }

  snapshot(): Promise<State> {
    return this.#adapter.snapshot();
  }

  async beginExecution(correlation: ExecutionCorrelation) {
    this.#correlations.set(correlation.traceId, structuredClone(correlation));
    return this.#adapter.beginExecution(correlation);
  }

  completeExecution(traceId: string) {
    this.#correlations.delete(traceId);
    return this.#adapter.completeExecution(traceId);
  }

  async executeStep(step: ScriptedToolStep, traceId: string): Promise<unknown> {
    const correlation = this.#correlations.get(traceId);
    if (correlation === undefined) {
      throw new Error(`Policy enforcement has no active execution for trace ${traceId}.`);
    }
    const knownTool = this.#tools.get(step.toolName);
    const rule = this.#policy.rules.find((candidate) => candidate.toolName === step.toolName);
    if (knownTool === undefined) {
      this.#recordDecision({
        correlation,
        step,
        effectiveDisposition: "DENY",
        decision: "BLOCKED",
        executed: false,
        reason: "The requested tool is outside the validated local target metadata and was blocked closed.",
        approvalRequired: false,
        approvalSupplied: false,
      });
      return blockedResult("BLOCKED", step.toolName);
    }

    const disposition = rule?.disposition ?? this.#policy.defaultDisposition;
    const approvalSupplied = this.#approvals.some(
      (grant) =>
        grant.scenarioId === correlation.scenarioId &&
        grant.stepId === step.id &&
        grant.toolName === step.toolName,
    );

    if (disposition === "DENY") {
      this.#recordDecision({
        correlation,
        step,
        effectiveDisposition: disposition,
        decision: "BLOCKED",
        executed: false,
        reason: "The effective policy disposition is DENY, so the tool was not invoked.",
        ...(rule === undefined ? {} : { rule }),
        approvalRequired: false,
        approvalSupplied: false,
      });
      return blockedResult("BLOCKED", step.toolName);
    }
    if (disposition === "REQUIRE_APPROVAL" && !approvalSupplied) {
      this.#recordDecision({
        correlation,
        step,
        effectiveDisposition: disposition,
        decision: "APPROVAL_REQUIRED",
        executed: false,
        reason: "No explicit approval grant was supplied for this exact local test step.",
        ...(rule === undefined ? {} : { rule }),
        approvalRequired: true,
        approvalSupplied: false,
      });
      return blockedResult("APPROVAL_REQUIRED", step.toolName);
    }
    if (disposition === "SANDBOX_ONLY" && !this.#sandboxSatisfied) {
      this.#recordDecision({
        correlation,
        step,
        effectiveDisposition: disposition,
        decision: "SANDBOX_REQUIRED",
        executed: false,
        reason: "The adapter was not explicitly marked as satisfying the disposable local sandbox boundary.",
        ...(rule === undefined ? {} : { rule }),
        approvalRequired: false,
        approvalSupplied: false,
      });
      return blockedResult("SANDBOX_REQUIRED", step.toolName);
    }

    this.#recordDecision({
      correlation,
      step,
      effectiveDisposition: disposition,
      decision: "ALLOWED",
      executed: true,
      reason:
        disposition === "REQUIRE_APPROVAL"
          ? "An explicit approval grant matched this exact local test step."
          : disposition === "SANDBOX_ONLY"
            ? "The adapter satisfies the declared disposable local sandbox boundary."
            : "The effective policy disposition is ALLOW.",
      ...(rule === undefined ? {} : { rule }),
      approvalRequired: disposition === "REQUIRE_APPROVAL",
      approvalSupplied,
    });
    return this.#adapter.executeStep(step, traceId);
  }

  #recordDecision(input: {
    correlation: ExecutionCorrelation;
    step: ScriptedToolStep;
    effectiveDisposition: PolicyDisposition;
    decision: PolicyDecisionOutcome;
    executed: boolean;
    reason: string;
    rule?: ToolPolicyRule;
    approvalRequired: boolean;
    approvalSupplied: boolean;
  }): void {
    this.#decisions.push(
      PolicyDecisionEvidenceSchema.parse({
        id: this.#ids.next("policy-decision"),
        timestamp: this.#clock.now(),
        runId: input.correlation.runId,
        scenarioId: input.correlation.scenarioId,
        executionId: input.correlation.executionId,
        traceId: input.correlation.traceId,
        stepId: input.step.id,
        toolName: input.step.toolName,
        requestedArguments: input.step.arguments,
        effectiveDisposition: input.effectiveDisposition,
        decision: input.decision,
        executed: input.executed,
        reason: input.reason,
        ...(input.rule === undefined ? {} : { relatedPolicyRule: input.rule }),
        approvalRequired: input.approvalRequired,
        approvalSupplied: input.approvalSupplied,
        sandboxSatisfied: this.#sandboxSatisfied,
      }),
    );
  }
}
