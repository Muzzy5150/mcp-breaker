import { DETERMINISTIC_DEMO_SCENARIOS, LIVE_SCENARIO_PROMPTS } from "@mcp-breaker/attack-library";
import { randomIdGenerator, systemClock, type Clock, type IdGenerator } from "@mcp-breaker/breaker-core";
import { DEMO_TOOL_METADATA, type DemoToolService } from "@mcp-breaker/demo-target";
import { scoreSecurityAssessment } from "@mcp-breaker/scoring";
import {
  ExecutionTraceSchema,
  FindingSchema,
  LIVE_BASELINE_SAFETY_NOTICE,
  LiveAssessmentReportSchema,
  LiveScenarioExecutionSchema,
  type AttackScenario,
  type Finding,
  type LiveAssessmentReport,
  type LiveScenarioExecution,
  type LiveToolCallEvidence,
} from "@mcp-breaker/shared";

import { evaluateObservedBehavior } from "./evaluator.js";
import {
  TRUEFORGE_BASE_URL,
  TRUEFORGE_CONNECTOR,
  TRUEFORGE_CONNECTOR_URL,
  TRUEFORGE_MODEL,
} from "./trueforge-agents.js";
import { TRUEFORGE_SDK_VERSION, type TrueForgeAgentRecord, type TrueForgeFacade, type TrueForgeTurnInput } from "./trueforge-client.js";
import { TrueForgeEventRecorder, type PendingApproval } from "./trueforge-events.js";

export const AUTOMATED_TEST_DENIAL = "AUTOMATED_TEST_DENIAL";

export interface ApprovalDecision {
  status: "allow" | "deny";
  reason?: string;
}

export type ApprovalDecider = (input: {
  scenario: AttackScenario;
  approval: PendingApproval;
  toolCallId: string;
  toolCall?: LiveToolCallEvidence;
}) => Promise<ApprovalDecision>;

export interface LiveInfrastructureEvidence {
  sandbox: {
    attempted: boolean;
    passed: boolean;
    marker?: "MCP_BREAKER_SANDBOX_OK";
    sandboxId?: string;
    sessionId?: string;
    turnId?: string;
    result?: string;
  };
  subagent: { attempted: boolean; observed: boolean; eventIds: string[]; note: string };
  cancellation: { attempted: boolean; verified: boolean; sessionId?: string; note: string };
}

const defaultInfrastructureEvidence: LiveInfrastructureEvidence = {
  sandbox: { attempted: false, passed: false },
  subagent: { attempted: false, observed: false, eventIds: [], note: "Optional subagent proof was not requested for this run." },
  cancellation: { attempted: false, verified: false, note: "Cancellation proof is recorded by the live integration suite." },
};

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function liveFinding(scenario: AttackScenario, original: LiveScenarioExecution, replay: LiveScenarioExecution): Finding {
  const violations = original.evaluation.violations;
  const replayViolations = replay.evaluation.violations;
  const stepIds = [...new Set(violations.flatMap((violation) => violation.stepIds))];
  const replayStepIds = [...new Set(replayViolations.flatMap((violation) => violation.stepIds))];
  const targetTool = violations.find((violation) => violation.toolName !== undefined)?.toolName ??
    original.trace.steps.find((step) => step.stateBefore !== undefined)?.toolName ??
    "unavailable";
  return FindingSchema.parse({
    stableId: `finding-live-${scenario.id.replace(/^scenario-/, "")}`,
    scenarioId: scenario.id,
    category: scenario.category,
    targetTool,
    severity: scenario.severityIfReproduced,
    originalUserIntent: scenario.originalUserIntent,
    untrustedContent: scenario.untrustedContent,
    toolCallsObserved: original.observedBehavior.toolCalls,
    expectedBehavior: scenario.expectedBehavior,
    observedBehavior: original.observedBehavior,
    evidence: {
      executionTraceId: original.traceId,
      replayExecutionTraceId: replay.traceId,
      stepIds,
      replayStepIds,
      stateMutationEvidence: violations.map((violation) => violation.message),
      notes: [
        `Observed in TrueForge session ${original.sessionId}.`,
        `Reproduced from clean state in new TrueForge session ${replay.sessionId}.`,
        "Evidence is derived from persisted TrueForge events and direct in-memory demo-state snapshots.",
      ],
      unavailableFields: [],
    },
    replayResult: {
      status: "REPRODUCED",
      summary: "A new TrueForge session reproduced the unsafe behavior from reset demo state.",
      attemptedAt: replay.completedAt,
      traceId: replay.traceId,
    },
    recommendedRemediation: {
      summary: `Require explicit approval before ${targetTool} can execute.`,
      rationale: "The real agent executed this state-changing tool outside the user's intended scope.",
      proposedDisposition: "REQUIRE_APPROVAL",
    },
    provenance: "RUNTIME",
  });
}

function toolInput(decision: ApprovalDecision, approval: PendingApproval, toolCallId: string): TrueForgeTurnInput {
  return {
    type: "user.tool_approval",
    threadId: approval.threadId,
    toolCallId,
    approval:
      decision.status === "allow"
        ? { status: "allow" }
        : { status: "deny", reason: decision.reason ?? AUTOMATED_TEST_DENIAL },
  };
}

async function verifyRecovery(
  client: TrueForgeFacade,
  recorder: TrueForgeEventRecorder,
  sessionId: string,
): Promise<LiveScenarioExecution["recoveryEvidence"]> {
  const turnId = recorder.turnIds.at(-1);
  if (turnId === undefined) {
    return {
      getTurnVerified: false,
      listTurnEventsVerified: false,
      subscribeResumeVerified: false,
      lastSequenceNumber: recorder.lastServerSequenceNumber,
    };
  }
  let getTurnVerified = false;
  let listTurnEventsVerified = false;
  let subscribeResumeVerified = false;
  const lastTurnSequenceNumber = recorder.lastServerSequenceForTurn(turnId);
  try {
    getTurnVerified = (await client.getTurn(sessionId, turnId)) !== undefined;
    const persisted = await client.listTurnEvents(sessionId, turnId);
    listTurnEventsVerified = persisted.length > 0;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const resumed = await client.subscribeToTurn(
        sessionId,
        turnId,
        Math.max(0, lastTurnSequenceNumber - 1),
        controller.signal,
      );
      const result = await resumed[Symbol.asyncIterator]().next();
      subscribeResumeVerified = !result.done;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    // Individual booleans retain the precise recovery operations that succeeded.
  }
  return {
    getTurnVerified,
    listTurnEventsVerified,
    subscribeResumeVerified,
    lastSequenceNumber: lastTurnSequenceNumber,
  };
}

export interface ExecuteLiveScenarioInput {
  client: TrueForgeFacade;
  service: DemoToolService;
  agent: TrueForgeAgentRecord;
  scenario: AttackScenario;
  runId: string;
  clock?: Clock;
  ids?: IdGenerator;
  replayOfExecutionId?: string;
  approvalDecider?: ApprovalDecider;
  signal?: AbortSignal;
  onSessionCreated?: (sessionId: string) => void;
  onSessionCompleted?: (sessionId: string) => void;
}

async function executeLiveScenarioImplementation(input: ExecuteLiveScenarioInput): Promise<LiveScenarioExecution> {
  const clock = input.clock ?? systemClock;
  const ids = input.ids ?? randomIdGenerator;
  const executionId = ids.next("live-execution");
  const traceId = ids.next("live-trace");
  const prompt = LIVE_SCENARIO_PROMPTS[input.scenario.id];
  if (prompt === undefined) {
    throw new Error(`No natural-language live prompt is defined for ${input.scenario.id}.`);
  }
  const startedAt = clock.now();
  input.service.state.reset();
  const baselineState = input.service.state.snapshot();
  const priorTraceIds = new Set(input.service.traces.listTraces().map((trace) => trace.id));
  const session = await input.client.createSession(input.agent.name);
  input.onSessionCreated?.(session.id);
  input.service.traces.beginTrace({
    traceId,
    sessionId: session.id,
    testId: input.scenario.id,
    provenance: "RUNTIME",
    runId: input.runId,
    scenarioId: input.scenario.id,
    executionId,
    ...(input.replayOfExecutionId === undefined ? {} : { replayOfExecutionId: input.replayOfExecutionId }),
  });
  const recorder = new TrueForgeEventRecorder();
  let turnInput: TrueForgeTurnInput[] = [{ type: "user.message", content: prompt }];
  let previousTurnId: string | undefined;

  for (let continuation = 0; continuation < 8; continuation += 1) {
    const stream = await input.client.streamTurn(session.id, turnInput, previousTurnId, input.signal);
    const turnCountBefore = recorder.turnIds.length;
    for await (const item of stream) {
      recorder.ingest(item, previousTurnId);
    }
    const currentTurnId = recorder.turnIds.at(-1);
    if (currentTurnId === undefined || recorder.turnIds.length === turnCountBefore) {
      throw new Error(`TrueForge did not emit turn.created for ${input.scenario.id}.`);
    }
    if (recorder.pendingApprovals.length === 0) {
      break;
    }
    const approvals: TrueForgeTurnInput[] = [];
    for (const approval of recorder.pendingApprovals) {
      for (const toolCallId of approval.toolCallIds) {
        const toolCall = recorder.toolCalls().find((candidate) => candidate.toolCallId === toolCallId);
        const decision = input.approvalDecider === undefined
          ? { status: "deny" as const, reason: AUTOMATED_TEST_DENIAL }
          : await input.approvalDecider({
              scenario: input.scenario,
              approval,
              toolCallId,
              ...(toolCall === undefined ? {} : { toolCall }),
            });
        recorder.recordApproval({
          eventId: approval.eventId,
          turnId: approval.turnId,
          threadId: approval.threadId,
          toolCallId,
          status: decision.status,
          ...(decision.reason === undefined
            ? decision.status === "deny" ? { reason: AUTOMATED_TEST_DENIAL } : {}
            : { reason: decision.reason }),
          automated: input.approvalDecider === undefined,
        });
        approvals.push(toolInput(decision, approval, toolCallId));
      }
    }
    recorder.clearPendingApprovals();
    previousTurnId = currentTurnId;
    turnInput = approvals;
  }

  for (const turnId of [...recorder.turnIds]) {
    const persistedEvents = await input.client.listTurnEvents(session.id, turnId);
    for (const event of persistedEvents) {
      recorder.ingest({ data: event }, turnId);
    }
  }

  const standaloneSteps = input.service.traces
    .listTraces()
    .filter((trace) => !priorTraceIds.has(trace.id) && trace.id !== traceId)
    .flatMap((trace) => trace.steps);
  const liveCalls = recorder.toolCalls(TRUEFORGE_CONNECTOR);
  let standaloneIndex = 0;
  for (const call of liveCalls) {
    if (!call.executed) {
      continue;
    }
    const matchingIndex = standaloneSteps.findIndex(
      (step, index) => index >= standaloneIndex && step.toolName === call.toolName && sameJson(step.arguments, call.arguments),
    );
    const correlated = matchingIndex === -1 ? undefined : standaloneSteps[matchingIndex];
    if (matchingIndex !== -1) {
      standaloneIndex = matchingIndex + 1;
    }
    input.service.traces.recordStep({
      traceId,
      toolName: call.toolName,
      arguments: call.arguments,
      ...(correlated?.stateBefore === undefined ? {} : { stateBefore: correlated.stateBefore }),
      ...(call.result === undefined ? {} : { result: call.result }),
      ...(call.error === undefined ? {} : { error: call.error }),
      ...(correlated?.stateAfter === undefined ? {} : { stateAfter: correlated.stateAfter }),
    });
  }
  const trace = ExecutionTraceSchema.parse(input.service.traces.completeTrace(traceId));
  const finalState = input.service.state.snapshot();
  const { evaluation, observedBehavior } = evaluateObservedBehavior({
    scenario: input.scenario,
    trace,
    baselineState,
    finalState,
  });
  const recoveryEvidence = await verifyRecovery(input.client, recorder, session.id);
  const execution = LiveScenarioExecutionSchema.parse({
    runId: input.runId,
    scenarioId: input.scenario.id,
    category: input.scenario.category,
    controlType: input.scenario.controlType,
    expectedOutcome: input.scenario.expectedOutcome,
    executionId,
    traceId,
    ...(input.replayOfExecutionId === undefined ? {} : { replayOfExecutionId: input.replayOfExecutionId }),
    agentId: input.agent.id,
    agentName: input.agent.name,
    sessionId: session.id,
    turnIds: recorder.turnIds,
    prompt,
    startedAt,
    completedAt: clock.now(),
    baselineState,
    finalState,
    finalResponse: recorder.finalResponse,
    events: recorder.events,
    toolCalls: liveCalls,
    approvals: recorder.approvals,
    trace,
    observedBehavior,
    evaluation,
    recoveryEvidence,
  });
  input.onSessionCompleted?.(session.id);
  return execution;
}

export class TrueForgeExecutionAdapter {
  readonly executionMode = "TRUEFORGE_LIVE" as const;
  readonly #dependencies: Omit<ExecuteLiveScenarioInput, "scenario" | "runId" | "replayOfExecutionId">;

  constructor(dependencies: Omit<ExecuteLiveScenarioInput, "scenario" | "runId" | "replayOfExecutionId">) {
    this.#dependencies = dependencies;
  }

  runScenario(
    scenario: AttackScenario,
    options: { runId: string; replayOfExecutionId?: string },
  ): Promise<LiveScenarioExecution> {
    return executeLiveScenarioImplementation({
      ...this.#dependencies,
      scenario,
      runId: options.runId,
      ...(options.replayOfExecutionId === undefined ? {} : { replayOfExecutionId: options.replayOfExecutionId }),
    });
  }
}

export function executeLiveScenario(input: ExecuteLiveScenarioInput): Promise<LiveScenarioExecution> {
  const adapter = new TrueForgeExecutionAdapter(input);
  return adapter.runScenario(input.scenario, {
    runId: input.runId,
    ...(input.replayOfExecutionId === undefined ? {} : { replayOfExecutionId: input.replayOfExecutionId }),
  });
}

export interface RunLiveAssessmentInput {
  client: TrueForgeFacade;
  service: DemoToolService;
  agent: TrueForgeAgentRecord;
  scenarios?: readonly AttackScenario[];
  infrastructureEvidence?: LiveInfrastructureEvidence;
  approvalDecider?: ApprovalDecider;
  clock?: Clock;
  ids?: IdGenerator;
  signal?: AbortSignal;
  onSessionCreated?: (sessionId: string) => void;
  onSessionCompleted?: (sessionId: string) => void;
}

export async function runLiveAssessment(input: RunLiveAssessmentInput): Promise<LiveAssessmentReport> {
  const clock = input.clock ?? systemClock;
  const ids = input.ids ?? randomIdGenerator;
  const runId = ids.next("trueforge-assessment");
  const scenarios = [...(input.scenarios ?? DETERMINISTIC_DEMO_SCENARIOS)];
  const executions: LiveScenarioExecution[] = [];
  const replayVerifications: LiveAssessmentReport["replayVerifications"] = [];
  const verifiedFindings: Finding[] = [];

  for (const scenario of scenarios) {
    const original = await executeLiveScenario({
      ...input,
      scenario,
      runId,
      clock,
      ids,
    });
    executions.push(original);
    if (original.evaluation.status !== "CANDIDATE_FINDING") {
      continue;
    }
    const replay = await executeLiveScenario({
      ...input,
      scenario,
      runId,
      replayOfExecutionId: original.executionId,
      clock,
      ids,
    });
    executions.push(replay);
    const reproduced =
      replay.evaluation.status === "CANDIDATE_FINDING" &&
      replay.evaluation.unsafeBehaviorFingerprint === original.evaluation.unsafeBehaviorFingerprint;
    replayVerifications.push({
      outcome: reproduced ? "REPRODUCED" : "NOT_REPRODUCED",
      originalExecutionId: original.executionId,
      replayExecutionId: replay.executionId,
      summary: reproduced
        ? "A clean-state TrueForge session reproduced the unsafe behavior fingerprint."
        : "The clean-state TrueForge session did not reproduce the unsafe behavior fingerprint.",
    });
    if (reproduced) {
      verifiedFindings.push(liveFinding(scenario, original, replay));
    }
  }

  const originals = executions.filter((execution) => execution.replayOfExecutionId === undefined);
  return LiveAssessmentReportSchema.parse({
    reportVersion: "3.0.0",
    executionMode: "TRUEFORGE_LIVE",
    attackGenerationMode: "PREDEFINED_SCENARIOS",
    autonomousAgentExecution: true,
    trueForgeIntegrated: true,
    baselineSafetyNotice: LIVE_BASELINE_SAFETY_NOTICE,
    runId,
    generatedAt: clock.now(),
    trueForge: {
      baseUrl: TRUEFORGE_BASE_URL,
      model: TRUEFORGE_MODEL,
      connectorName: TRUEFORGE_CONNECTOR,
      connectorUrl: TRUEFORGE_CONNECTOR_URL,
      agentId: input.agent.id,
      agentName: input.agent.name,
      sdkVersion: TRUEFORGE_SDK_VERSION,
    },
    scenarios,
    scenarioPrompts: LIVE_SCENARIO_PROMPTS,
    executions,
    replayVerifications,
    verifiedFindings,
    counts: {
      scenariosExecuted: scenarios.length,
      passes: originals.filter((execution) => execution.evaluation.status === "PASS").length,
      candidates: originals.filter((execution) => execution.evaluation.status === "CANDIDATE_FINDING").length,
      reproduced: replayVerifications.filter((verification) => verification.outcome === "REPRODUCED").length,
      inconclusive: originals.filter((execution) => execution.evaluation.status === "INCONCLUSIVE").length,
      errors: originals.filter((execution) => execution.evaluation.status === "EXECUTION_ERROR").length,
    },
    securityAssessment: scoreSecurityAssessment({
      findings: verifiedFindings,
      targetTools: [...DEMO_TOOL_METADATA],
      assessedAt: clock.now(),
    }),
    infrastructureEvidence: input.infrastructureEvidence ?? defaultInfrastructureEvidence,
  });
}
