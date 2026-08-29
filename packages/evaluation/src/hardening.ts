import { DETERMINISTIC_DEMO_SCENARIOS } from "@mcp-breaker/attack-library";
import {
  describePolicyProvenance,
  deriveCurrentDemoPolicy,
  generateRemediationPolicy,
  randomIdGenerator,
  systemClock,
  validatePolicyOrThrow,
  type Clock,
  type IdGenerator,
} from "@mcp-breaker/breaker-core";
import { DEMO_TOOL_METADATA } from "@mcp-breaker/demo-target";
import {
  PolicyChangeSchema,
  RemediationResultSchema,
  Stage4HardeningReportSchema,
  type AttackScenario,
  type Finding,
  type PolicyDecisionEvidence,
  type RemediationResult,
  type ScenarioExecution,
  type Stage4HardeningReport,
} from "@mcp-breaker/shared";

import { DeterministicExecutionAdapter, type ExecutionAdapter } from "./adapter.js";
import { runAssessment } from "./assessment.js";
import { PolicyEnforcedExecutionAdapter } from "./policy-adapter.js";
import { ScenarioRunner } from "./runner.js";

export interface HardeningDependencies {
  adapter?: ExecutionAdapter;
  clock?: Clock;
  ids?: IdGenerator;
  proposedPolicyOverride?: unknown;
  sandboxSatisfied?: boolean;
}

function originalExecution(executions: readonly ScenarioExecution[], scenarioId: string): ScenarioExecution | undefined {
  return executions.find(
    (execution) => execution.scenarioId === scenarioId && execution.replayOfExecutionId === undefined,
  );
}

function decisionsFor(
  decisions: readonly PolicyDecisionEvidence[],
  executionId: string,
  toolName: string,
): PolicyDecisionEvidence[] {
  return decisions.filter(
    (decision) => decision.executionId === executionId && decision.toolName === toolName,
  );
}

function remediationResult(input: {
  finding: Finding;
  provenance: ReturnType<typeof describePolicyProvenance>;
  retest: ScenarioExecution;
  replay: ScenarioExecution;
  decisions: readonly PolicyDecisionEvidence[];
  remainingFinding: Finding | undefined;
}): RemediationResult {
  const policyChange = input.provenance.find((entry) => entry.toolName === input.finding.targetTool);
  if (policyChange === undefined) {
    throw new Error(`Missing policy provenance for ${input.finding.targetTool}.`);
  }
  const retestDecisions = decisionsFor(input.decisions, input.retest.executionId, input.finding.targetTool);
  const replayDecisions = decisionsFor(input.decisions, input.replay.executionId, input.finding.targetTool);
  const retestDecision = retestDecisions[0];
  const replayDecision = replayDecisions[0];
  const blockedDecisions = [...retestDecisions, ...replayDecisions].filter((decision) => !decision.executed);
  const executionErrored =
    input.retest.evaluation.status === "EXECUTION_ERROR" || input.replay.evaluation.status === "EXECUTION_ERROR";
  const relevantAttemptMissing = retestDecision === undefined || replayDecision === undefined;
  const toolExecuted = retestDecisions.some((decision) => decision.executed);
  const stateMutationOccurred = input.retest.observedBehavior.stateChanged;
  const replayConsistent =
    !input.replay.observedBehavior.stateChanged &&
    replayDecision !== undefined &&
    retestDecision !== undefined &&
    replayDecision.decision === retestDecision.decision &&
    replayDecision.executed === retestDecision.executed;
  const status = executionErrored
    ? "RETEST_ERROR"
    : input.remainingFinding !== undefined || toolExecuted || stateMutationOccurred
      ? "NOT_REMEDIATED"
      : relevantAttemptMissing || blockedDecisions.length === 0 || !replayConsistent
        ? "INCONCLUSIVE"
        : "REMEDIATED";
  const summary =
    status === "REMEDIATED"
      ? `The same ${input.finding.targetTool} attempt was blocked before execution in both clean-state policy retests.`
      : status === "NOT_REMEDIATED"
        ? `The original unsafe behavior remained executable or reproducible under the supplied policy.`
        : status === "RETEST_ERROR"
          ? "The policy-enforced retest encountered an execution error."
          : "The retest did not capture enough consistent policy evidence to prove remediation.";

  return RemediationResultSchema.parse({
    findingId: input.finding.stableId,
    scenarioId: input.finding.scenarioId,
    originalSeverity: input.finding.severity,
    affectedTool: input.finding.targetTool,
    currentDisposition: policyChange.currentDisposition,
    proposedDisposition: policyChange.proposedDisposition,
    retestExecutionId: input.retest.executionId,
    replayExecutionId: input.replay.executionId,
    blockedDecisionIds: blockedDecisions.map((decision) => decision.id),
    stateMutationPrevented: !stateMutationOccurred,
    status,
    summary,
    before: {
      userIntent: input.finding.originalUserIntent,
      untrustedContent: input.finding.untrustedContent,
      unsafeToolAttempted: true,
      unsafeToolExecuted: true,
      stateMutationOccurred: true,
      replayReproduced: true,
      executionTraceId: input.finding.evidence.executionTraceId,
      replayTraceId: input.finding.evidence.replayExecutionTraceId,
    },
    after: {
      sameScenarioRetested: true,
      relevantToolAttempted: retestDecision !== undefined,
      ...(retestDecision === undefined ? {} : { policyDecision: retestDecision.decision }),
      toolExecuted,
      stateMutationOccurred,
      cleanStateReplayConsistent: replayConsistent,
      retestTraceId: input.retest.traceId,
      replayTraceId: input.replay.traceId,
    },
  });
}

export async function runHardeningAssessment(
  scenarios: readonly AttackScenario[] = DETERMINISTIC_DEMO_SCENARIOS,
  dependencies: HardeningDependencies = {},
): Promise<Stage4HardeningReport> {
  const clock = dependencies.clock ?? systemClock;
  const ids = dependencies.ids ?? randomIdGenerator;
  const adapter = dependencies.adapter ?? new DeterministicExecutionAdapter();
  const runId = ids.next("hardening");
  const baselineAssessment = await runAssessment(scenarios, { adapter, clock, ids });
  const currentPolicy = deriveCurrentDemoPolicy(DEMO_TOOL_METADATA);
  const generated = generateRemediationPolicy({
    currentPolicy,
    findings: baselineAssessment.verifiedFindings,
    tools: DEMO_TOOL_METADATA,
  });
  const proposedPolicy =
    dependencies.proposedPolicyOverride === undefined
      ? generated.proposedPolicy
      : validatePolicyOrThrow(dependencies.proposedPolicyOverride, DEMO_TOOL_METADATA, "Proposed override");
  if (proposedPolicy.approvalStatus !== "PROPOSED") {
    throw new Error("The Stage 4 policy must remain PROPOSED and must not contain fake approval state.");
  }
  const provenance =
    dependencies.proposedPolicyOverride === undefined
      ? generated.provenance
      : describePolicyProvenance({
          currentPolicy,
          proposedPolicy,
          findings: baselineAssessment.verifiedFindings,
          tools: DEMO_TOOL_METADATA,
        });
  const policyDiff = provenance.filter((entry) => entry.changed).map((entry) => PolicyChangeSchema.parse(entry));
  const policyAdapter = new PolicyEnforcedExecutionAdapter(adapter, proposedPolicy, DEMO_TOOL_METADATA, {
    sandboxSatisfied: dependencies.sandboxSatisfied ?? true,
    clock,
    ids,
  });
  const postHardeningAssessment = await runAssessment(scenarios, {
    adapter: policyAdapter,
    clock,
    ids,
  });
  const hardenedExecutions = [...postHardeningAssessment.executions];
  const proofRunner = new ScenarioRunner(policyAdapter, clock, ids);
  const remediationPairs: Array<{ finding: Finding; retest: ScenarioExecution; replay: ScenarioExecution }> = [];

  for (const finding of baselineAssessment.verifiedFindings) {
    const scenario = scenarios.find((candidate) => candidate.id === finding.scenarioId);
    const retest = originalExecution(postHardeningAssessment.executions, finding.scenarioId);
    if (scenario === undefined || retest === undefined) {
      throw new Error(`The hardened suite did not execute baseline scenario ${finding.scenarioId}.`);
    }
    const replay = await proofRunner.runScenario(scenario, {
      runId: postHardeningAssessment.runId,
      replayOfExecutionId: retest.executionId,
    });
    hardenedExecutions.push(replay);
    remediationPairs.push({ finding, retest, replay });
  }

  const decisions = policyAdapter.decisions;
  const remediationResults = remediationPairs.map(({ finding, retest, replay }) =>
    remediationResult({
      finding,
      provenance,
      retest,
      replay,
      decisions,
      remainingFinding: postHardeningAssessment.verifiedFindings.find(
        (candidate) => candidate.scenarioId === finding.scenarioId,
      ),
    }),
  );

  return Stage4HardeningReportSchema.parse({
    reportVersion: "2.0.0",
    executionMode: "DETERMINISTIC_LOCAL_DEMO",
    enforcementMode: "LOCAL_POLICY_SIMULATION",
    autonomousAgentExecution: false,
    trueForgeIntegrated: false,
    policyAppliedToTrueForge: false,
    runId,
    generatedAt: clock.now(),
    baselineAssessment,
    currentPolicy,
    proposedPolicy,
    policyDiff,
    policyGenerationProvenance: provenance,
    hardenedExecutions,
    policyDecisions: decisions,
    postHardeningAssessment,
    remediationResults,
  });
}
