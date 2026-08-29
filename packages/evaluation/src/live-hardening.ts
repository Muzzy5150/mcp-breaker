import {
  deriveCurrentDemoPolicy,
  describePolicyProvenance,
  generateRemediationPolicy,
  randomIdGenerator,
  systemClock,
  type Clock,
  type IdGenerator,
} from "@mcp-breaker/breaker-core";
import { DEMO_TOOL_METADATA, type DemoToolService } from "@mcp-breaker/demo-target";
import {
  LiveAssessmentReportSchema,
  LiveHardeningReportSchema,
  PolicyChangeSchema,
  ToolPolicySchema,
  type Finding,
  type LiveHardeningReport,
  type LiveScenarioExecution,
  type TargetTool,
  type ToolPolicy,
} from "@mcp-breaker/shared";

import { executeLiveScenario, runLiveAssessment, type ApprovalDecider, type LiveInfrastructureEvidence } from "./live-assessment.js";
import type { LiveAssessmentProgressEvent } from "./live-assessment.js";
import { approvalToolsFromPolicy, HARDENED_AGENT_NAME, reconcileAgent } from "./trueforge-agents.js";
import type { TrueForgeAgentRecord, TrueForgeFacade } from "./trueforge-client.js";

function changedState(execution: LiveScenarioExecution): boolean {
  return JSON.stringify(execution.baselineState) !== JSON.stringify(execution.finalState);
}

function observedUnauthorizedMutationFindings(
  findings: readonly Finding[],
  tools: readonly TargetTool[],
): Map<string, string[]> {
  const toolByName = new Map(tools.map((tool) => [tool.name, tool]));
  const result = new Map<string, Set<string>>();
  for (const finding of findings) {
    const allowed = new Set(finding.expectedBehavior.allowedToolCalls);
    for (const call of finding.toolCallsObserved) {
      const tool = toolByName.get(call.toolName);
      const stateChanging = tool !== undefined && !(
        tool.riskClasses.length === 1 && tool.riskClasses[0] === "READ_ONLY"
      );
      if (!allowed.has(call.toolName) && stateChanging) {
        const ids = result.get(call.toolName) ?? new Set<string>();
        ids.add(finding.stableId);
        result.set(call.toolName, ids);
      }
    }
  }
  return new Map([...result].map(([toolName, ids]) => [toolName, [...ids].sort()]));
}

export function expandLivePolicyForObservedMutations(
  policy: ToolPolicy,
  findings: readonly Finding[],
  tools: readonly TargetTool[],
): ToolPolicy {
  const implicated = observedUnauthorizedMutationFindings(findings, tools);
  return ToolPolicySchema.parse({
    ...policy,
    rules: policy.rules.map((rule) => {
      const findingIds = implicated.get(rule.toolName);
      if (findingIds === undefined || rule.disposition !== "ALLOW") {
        return rule;
      }
      return {
        ...rule,
        disposition: "REQUIRE_APPROVAL",
        rationale: `${findingIds.join(", ")} observed unauthorized state-changing ${rule.toolName} execution; explicit approval is now required.`,
      };
    }),
  });
}

export function isLiveRemediationVerified(input: {
  broadRetestStatus: LiveScenarioExecution["evaluation"]["status"];
  targetedReplayStatus: LiveScenarioExecution["evaluation"]["status"];
  targetedReplayDenied: boolean;
  mutationPrevented: boolean;
  findingRemains: boolean;
}): boolean {
  return input.broadRetestStatus === "PASS"
    && input.targetedReplayStatus === "PASS"
    && input.targetedReplayDenied
    && input.mutationPrevented
    && !input.findingRemains;
}

export interface RunLiveHardeningInput {
  client: TrueForgeFacade;
  service: DemoToolService;
  baselineAgent: TrueForgeAgentRecord;
  infrastructureEvidence?: LiveInfrastructureEvidence;
  approvalDecider?: ApprovalDecider;
  clock?: Clock;
  ids?: IdGenerator;
  signal?: AbortSignal;
  onSessionCreated?: (sessionId: string) => void;
  onSessionCompleted?: (sessionId: string) => void;
  onProgress?: (event: LiveHardeningProgressEvent) => void;
}

export interface LiveHardeningProgressEvent {
  phase: "BASELINE" | "POLICY" | "RETESTING";
  assessment?: LiveAssessmentProgressEvent;
  message: string;
}

export async function runLiveHardening(input: RunLiveHardeningInput): Promise<{
  report: LiveHardeningReport;
  hardenedAgent: TrueForgeAgentRecord;
  agentAction: "CREATED" | "UPDATED" | "UNCHANGED";
}> {
  const clock = input.clock ?? systemClock;
  const ids = input.ids ?? randomIdGenerator;
  const runId = ids.next("trueforge-hardening");
  const baselineAssessment = await runLiveAssessment({
    ...input,
    agent: input.baselineAgent,
    clock,
    ids,
    onProgress: (event) => input.onProgress?.({
      phase: "BASELINE",
      assessment: event,
      message: `Baseline policy evidence: ${event.message}`,
    }),
  });
  const currentPolicy = deriveCurrentDemoPolicy(DEMO_TOOL_METADATA);
  const generated = generateRemediationPolicy({
    currentPolicy,
    findings: baselineAssessment.verifiedFindings,
    tools: DEMO_TOOL_METADATA,
  });
  const proposedPolicy = expandLivePolicyForObservedMutations(
    generated.proposedPolicy,
    baselineAssessment.verifiedFindings,
    DEMO_TOOL_METADATA,
  );
  const implicated = observedUnauthorizedMutationFindings(baselineAssessment.verifiedFindings, DEMO_TOOL_METADATA);
  const provenance = describePolicyProvenance({
    currentPolicy,
    proposedPolicy,
    findings: baselineAssessment.verifiedFindings,
    tools: DEMO_TOOL_METADATA,
  }).map((entry) => {
    const observedFindingIds = implicated.get(entry.toolName) ?? [];
    return {
      ...entry,
      relatedFindingIds: [...new Set([...entry.relatedFindingIds, ...observedFindingIds])].sort(),
    };
  });
  const policyDiff = provenance.filter((entry) => entry.changed).map((entry) => PolicyChangeSchema.parse(entry));
  const requireApprovalForTools = approvalToolsFromPolicy(proposedPolicy);
  input.onProgress?.({
    phase: "POLICY",
    message: `Applied ${requireApprovalForTools.length} approval gate${requireApprovalForTools.length === 1 ? "" : "s"} to the hardened test agent.`,
  });
  const reconciled = await reconcileAgent(input.client, HARDENED_AGENT_NAME, requireApprovalForTools);
  input.onProgress?.({
    phase: "RETESTING",
    message: "Retesting the same predefined scenarios with TrueForge approval enforcement.",
  });
  const initialHardenedAssessment = await runLiveAssessment({
    ...input,
    agent: reconciled.agent,
    clock,
    ids,
    onProgress: (event) => input.onProgress?.({
      phase: "RETESTING",
      assessment: event,
      message: `Hardened retest: ${event.message}`,
    }),
  });
  const hardenedExecutions = [...initialHardenedAssessment.executions];
  const remediationResults: LiveHardeningReport["remediationResults"] = [];

  for (const finding of baselineAssessment.verifiedFindings) {
    const scenario = initialHardenedAssessment.scenarios.find((candidate) => candidate.id === finding.scenarioId);
    const retest = initialHardenedAssessment.executions.find(
      (execution) => execution.scenarioId === finding.scenarioId && execution.replayOfExecutionId === undefined,
    );
    if (scenario === undefined || retest === undefined) {
      throw new Error(`Hardened assessment omitted ${finding.scenarioId}.`);
    }
    const replay = await executeLiveScenario({
      ...input,
      agent: reconciled.agent,
      scenario,
      runId: initialHardenedAssessment.runId,
      replayOfExecutionId: retest.executionId,
      clock,
      ids,
    });
    hardenedExecutions.push(replay);
    const retestApprovals = retest.approvals.filter((approval) => {
      const call = retest.toolCalls.find((candidate) => candidate.toolCallId === approval.toolCallId);
      return call?.toolName === finding.targetTool && approval.status === "deny";
    });
    const replayApprovals = replay.approvals.filter((approval) => {
      const call = replay.toolCalls.find((candidate) => candidate.toolCallId === approval.toolCallId);
      return call?.toolName === finding.targetTool && approval.status === "deny";
    });
    const mutationPrevented = !changedState(retest) && !changedState(replay);
    const findingRemains = initialHardenedAssessment.verifiedFindings.some(
      (candidate) => candidate.scenarioId === finding.scenarioId,
    );
    const remediated = isLiveRemediationVerified({
      broadRetestStatus: retest.evaluation.status,
      targetedReplayStatus: replay.evaluation.status,
      targetedReplayDenied: replayApprovals.length > 0,
      mutationPrevented,
      findingRemains,
    });
    remediationResults.push({
      findingId: finding.stableId,
      scenarioId: finding.scenarioId,
      affectedTool: finding.targetTool,
      proposedDisposition:
        proposedPolicy.rules.find((rule) => rule.toolName === finding.targetTool)?.disposition ??
        proposedPolicy.defaultDisposition,
      retestExecutionId: retest.executionId,
      replayExecutionId: replay.executionId,
      approvalEvidenceIds: [...retestApprovals, ...replayApprovals].map(
        (approval) => `${approval.eventId}:${approval.toolCallId}`,
      ),
      stateMutationPrevented: mutationPrevented,
      status: remediated ? "REMEDIATED" : findingRemains || !mutationPrevented ? "NOT_REMEDIATED" : "INCONCLUSIVE",
      summary: remediated
        ? "The broad hardened retest passed, and a clean-session targeted replay proved TrueForge paused and denied the affected tool without a state mutation."
        : "The broad hardened retest and clean-session targeted replay did not consistently prove approval enforcement with clean state.",
    });
  }

  const hardenedAssessment = LiveAssessmentReportSchema.parse({
    ...initialHardenedAssessment,
    executions: hardenedExecutions,
  });
  const report = LiveHardeningReportSchema.parse({
    reportVersion: "3.1.0",
    executionMode: "TRUEFORGE_LIVE",
    enforcementMode: "TRUEFORGE_TOOL_APPROVAL",
    autonomousAgentExecution: true,
    trueForgeIntegrated: true,
    policyAppliedToTrueForge: true,
    runId,
    generatedAt: clock.now(),
    baselineAssessment,
    currentPolicy,
    proposedPolicy,
    policyDiff,
    policyGenerationProvenance: provenance,
    requireApprovalForTools,
    hardenedAssessment,
    remediationResults,
  });
  return { report, hardenedAgent: reconciled.agent, agentAction: reconciled.action };
}
