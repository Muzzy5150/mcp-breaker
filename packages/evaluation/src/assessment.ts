import { DETERMINISTIC_DEMO_SCENARIOS } from "@mcp-breaker/attack-library";
import { randomIdGenerator, systemClock, type Clock, type IdGenerator } from "@mcp-breaker/breaker-core";
import { DEMO_TOOL_METADATA } from "@mcp-breaker/demo-target";
import { scoreSecurityAssessment } from "@mcp-breaker/scoring";
import {
  DeterministicAssessmentReportSchema,
  FindingSchema,
  ReplayVerificationSchema,
  type AttackScenario,
  type DeterministicAssessmentReport,
  type Finding,
  type ReplayVerification,
  type ScenarioExecution,
} from "@mcp-breaker/shared";

import { DeterministicExecutionAdapter, type ExecutionAdapter } from "./adapter.js";
import { ScenarioRunner } from "./runner.js";

function violatingStepIds(execution: ScenarioExecution): string[] {
  return [...new Set(execution.evaluation.violations.flatMap((violation) => violation.stepIds))];
}

function targetTool(execution: ScenarioExecution): string {
  const violation = execution.evaluation.violations.find((entry) => entry.toolName !== undefined);
  if (violation?.toolName !== undefined) {
    return violation.toolName;
  }
  const changed = execution.trace.steps.find((step) => step.stateBefore !== undefined);
  return changed?.toolName ?? "unavailable";
}

function promoteFinding(
  scenario: AttackScenario,
  original: ScenarioExecution,
  replay: ScenarioExecution,
): Finding {
  const originalStepIds = violatingStepIds(original);
  const replayStepIds = violatingStepIds(replay);
  return FindingSchema.parse({
    stableId: `finding-${scenario.id.replace(/^scenario-/, "")}`,
    scenarioId: scenario.id,
    category: scenario.category,
    targetTool: targetTool(original),
    severity: scenario.severityIfReproduced,
    originalUserIntent: scenario.originalUserIntent,
    untrustedContent: scenario.untrustedContent,
    toolCallsObserved: original.observedBehavior.toolCalls,
    expectedBehavior: scenario.expectedBehavior,
    observedBehavior: original.observedBehavior,
    evidence: {
      executionTraceId: original.traceId,
      replayExecutionTraceId: replay.traceId,
      stepIds: originalStepIds,
      replayStepIds,
      stateMutationEvidence: original.evaluation.violations.map((violation) => violation.message),
      notes: [
        "Produced by a deterministic local unsafe fixture, not autonomous agent behavior.",
        `Original execution ${original.executionId} was reproduced by ${replay.executionId}.`,
      ],
      unavailableFields: [],
    },
    replayResult: {
      status: "REPRODUCED",
      summary: "The replay produced the same unsafe behavior fingerprint from reset demo state.",
      attemptedAt: replay.completedAt,
      traceId: replay.traceId,
    },
    recommendedRemediation: {
      summary: "Require explicit authorization for the observed state-changing tool and constrain its scope.",
      rationale: "This is a placeholder recommendation based on the deterministic fixture evidence.",
      proposedDisposition: "REQUIRE_APPROVAL",
    },
    provenance: "RUNTIME",
  });
}

export interface AssessmentDependencies {
  adapter?: ExecutionAdapter;
  clock?: Clock;
  ids?: IdGenerator;
}

export async function runAssessment(
  scenarios: readonly AttackScenario[] = DETERMINISTIC_DEMO_SCENARIOS,
  dependencies: AssessmentDependencies = {},
): Promise<DeterministicAssessmentReport> {
  const clock = dependencies.clock ?? systemClock;
  const ids = dependencies.ids ?? randomIdGenerator;
  const adapter = dependencies.adapter ?? new DeterministicExecutionAdapter();
  const runner = new ScenarioRunner(adapter, clock, ids);
  const runId = ids.next("assessment");
  const executions: ScenarioExecution[] = [];
  const replayVerifications: ReplayVerification[] = [];
  const verifiedFindings: Finding[] = [];

  for (const scenario of scenarios) {
    const execution = await runner.runScenario(scenario, { runId });
    executions.push(execution);
    if (execution.evaluation.status !== "CANDIDATE_FINDING") {
      continue;
    }

    let replayExecution: ScenarioExecution | undefined;
    try {
      replayExecution = await runner.runScenario(scenario, {
        runId,
        replayOfExecutionId: execution.executionId,
      });
      executions.push(replayExecution);
      const replayErrored = replayExecution.evaluation.status === "EXECUTION_ERROR";
      const reproduced =
        replayExecution.evaluation.status === "CANDIDATE_FINDING" &&
        replayExecution.evaluation.unsafeBehaviorFingerprint === execution.evaluation.unsafeBehaviorFingerprint;
      const verification = ReplayVerificationSchema.parse({
        outcome: replayErrored ? "REPLAY_ERROR" : reproduced ? "REPRODUCED" : "NOT_REPRODUCED",
        summary: replayErrored
          ? `Replay execution failed: ${replayExecution.evaluation.summary}`
          : reproduced
            ? "Replay matched the original unsafe behavior fingerprint."
            : "Replay did not match the original unsafe behavior fingerprint.",
        originalExecutionId: execution.executionId,
        replayExecutionId: replayExecution.executionId,
        replayTraceId: replayExecution.traceId,
        replayExecution,
      });
      replayVerifications.push(verification);
      if (reproduced) {
        verifiedFindings.push(promoteFinding(scenario, execution, replayExecution));
      }
    } catch (error) {
      replayVerifications.push(
        ReplayVerificationSchema.parse({
          outcome: "REPLAY_ERROR",
          summary: error instanceof Error ? error.message : String(error),
          originalExecutionId: execution.executionId,
          ...(replayExecution === undefined
            ? {}
            : {
                replayExecutionId: replayExecution.executionId,
                replayTraceId: replayExecution.traceId,
                replayExecution,
              }),
        }),
      );
    }
  }

  const originalExecutions = executions.filter((execution) => execution.replayOfExecutionId === undefined);
  const assessment = scoreSecurityAssessment({
    findings: verifiedFindings,
    targetTools: [...DEMO_TOOL_METADATA],
    assessedAt: clock.now(),
  });
  return DeterministicAssessmentReportSchema.parse({
    reportVersion: "1.0.0",
    executionMode: "DETERMINISTIC_LOCAL_DEMO",
    autonomousAgentExecution: false,
    runId,
    generatedAt: clock.now(),
    scenarios,
    executions,
    replayVerifications,
    verifiedFindings,
    counts: {
      scenariosExecuted: originalExecutions.length,
      passes: originalExecutions.filter((execution) => execution.evaluation.status === "PASS").length,
      candidates: originalExecutions.filter((execution) => execution.evaluation.status === "CANDIDATE_FINDING").length,
      reproduced: replayVerifications.filter((verification) => verification.outcome === "REPRODUCED").length,
      inconclusive: originalExecutions.filter((execution) => execution.evaluation.status === "INCONCLUSIVE").length,
      errors:
        originalExecutions.filter((execution) => execution.evaluation.status === "EXECUTION_ERROR").length +
        replayVerifications.filter((verification) => verification.outcome === "REPLAY_ERROR").length,
    },
    securityAssessment: assessment,
  });
}
