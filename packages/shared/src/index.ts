import { z } from "zod";

export const ToolRiskSchema = z.enum([
  "READ_ONLY",
  "WRITE",
  "DESTRUCTIVE",
  "EXTERNAL_COMMUNICATION",
  "PRIVILEGED",
  "CODE_EXECUTION",
]);
export type ToolRisk = z.infer<typeof ToolRiskSchema>;

export const AttackCategorySchema = z.enum([
  "INDIRECT_PROMPT_INJECTION",
  "UNAUTHORIZED_WRITE",
  "DESTRUCTIVE_ACTION",
  "CONFUSED_DEPUTY",
]);
export type AttackCategory = z.infer<typeof AttackCategorySchema>;

export const FindingSeveritySchema = z.enum(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;

export const EvidenceProvenanceSchema = z.enum(["RUNTIME", "TEST_FIXTURE"]);
export type EvidenceProvenance = z.infer<typeof EvidenceProvenanceSchema>;

export const ReproducibilityStatusSchema = z.enum([
  "NOT_ATTEMPTED",
  "REPRODUCED",
  "NOT_REPRODUCED",
  "REPLAY_ERROR",
  "INCONCLUSIVE",
]);
export type ReproducibilityStatus = z.infer<typeof ReproducibilityStatusSchema>;

export const PolicyDispositionSchema = z.enum(["ALLOW", "DENY", "REQUIRE_APPROVAL", "SANDBOX_ONLY"]);
export type PolicyDisposition = z.infer<typeof PolicyDispositionSchema>;

export const PolicyApprovalStatusSchema = z.enum(["DRAFT", "PENDING_APPROVAL", "APPROVED"]);
export type PolicyApprovalStatus = z.infer<typeof PolicyApprovalStatusSchema>;

export const TargetToolSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_]*$/),
    description: z.string().min(1),
    riskClasses: z.array(ToolRiskSchema).min(1),
    approvalNormallyRequired: z.boolean(),
    expectedAllowedContexts: z.array(z.string().min(1)).min(1),
  })
  .superRefine((tool, context) => {
    if (new Set(tool.riskClasses).size !== tool.riskClasses.length) {
      context.addIssue({ code: "custom", message: "Tool risk classes must be unique.", path: ["riskClasses"] });
    }
    if (tool.riskClasses.includes("READ_ONLY") && tool.riskClasses.length !== 1) {
      context.addIssue({
        code: "custom",
        message: "READ_ONLY cannot be combined with state-changing risk classes.",
        path: ["riskClasses"],
      });
    }
  });
export type TargetTool = z.infer<typeof TargetToolSchema>;

export const ExpectedBehaviorSchema = z.object({
  summary: z.string().min(1),
  stateChangeAllowed: z.boolean(),
  allowedToolCalls: z.array(z.string().min(1)),
  prohibitedToolCalls: z.array(z.string().min(1)),
  prohibitedArguments: z.array(
    z.object({
      toolName: z.string().min(1),
      argumentPath: z.string().regex(/^[A-Za-z0-9_.-]+$/),
      equals: z.json(),
      description: z.string().min(1),
    }),
  ),
  stateConstraints: z.array(z.string().min(1)),
});
export type ExpectedBehavior = z.infer<typeof ExpectedBehaviorSchema>;

export const ObservedToolCallSchema = z.object({
  toolName: z.string().min(1),
  arguments: z.json(),
  result: z.json().optional(),
  error: z.string().min(1).optional(),
});
export type ObservedToolCall = z.infer<typeof ObservedToolCallSchema>;

export const ObservedBehaviorSchema = z.object({
  summary: z.string().min(1),
  stateChanged: z.boolean(),
  matchedExpectedBehavior: z.boolean(),
  toolCalls: z.array(ObservedToolCallSchema),
});
export type ObservedBehavior = z.infer<typeof ObservedBehaviorSchema>;

export const ExecutionStepSchema = z
  .object({
    id: z.string().min(1),
    sequence: z.number().int().nonnegative(),
    timestamp: z.iso.datetime(),
    sessionId: z.string().min(1),
    testId: z.string().min(1),
    runId: z.string().min(1).optional(),
    scenarioId: z.string().min(1).optional(),
    executionId: z.string().min(1).optional(),
    toolName: z.string().min(1),
    arguments: z.json(),
    stateBefore: z.json().optional(),
    result: z.json().optional(),
    error: z.string().min(1).optional(),
    stateAfter: z.json().optional(),
    sensitiveDataRedacted: z.boolean(),
  })
  .superRefine((step, context) => {
    if (step.result === undefined && step.error === undefined) {
      context.addIssue({ code: "custom", message: "A step must contain a result or error." });
    }
    if (step.result !== undefined && step.error !== undefined) {
      context.addIssue({ code: "custom", message: "A step cannot contain both a result and error." });
    }
  });
export type ExecutionStep = z.infer<typeof ExecutionStepSchema>;

export const ExecutionTraceSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  testId: z.string().min(1),
  runId: z.string().min(1).optional(),
  scenarioId: z.string().min(1).optional(),
  executionId: z.string().min(1).optional(),
  replayOfExecutionId: z.string().min(1).optional(),
  provenance: EvidenceProvenanceSchema,
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().optional(),
  steps: z.array(ExecutionStepSchema),
});
export type ExecutionTrace = z.infer<typeof ExecutionTraceSchema>;

export const ScriptedToolStepSchema = z.object({
  id: z.string().regex(/^step-[a-z0-9-]+$/),
  toolName: z.string().min(1),
  arguments: z.json(),
});
export type ScriptedToolStep = z.infer<typeof ScriptedToolStepSchema>;

export const StateConditionSchema = z
  .object({
    id: z.string().regex(/^condition-[a-z0-9-]+$/),
    description: z.string().min(1),
    path: z.string().regex(/^\/(?:[^/~]|~[01])+(?:\/(?:[^/~]|~[01])+)*$/),
    operator: z.enum(["EQUALS_BASELINE", "EQUALS", "EXISTS", "NOT_EXISTS"]),
    expected: z.json().optional(),
  })
  .superRefine((condition, context) => {
    if (condition.operator === "EQUALS" && condition.expected === undefined) {
      context.addIssue({ code: "custom", message: "EQUALS conditions require an expected value." });
    }
  });
export type StateCondition = z.infer<typeof StateConditionSchema>;

export const AttackScenarioSchema = z.object({
  id: z.string().regex(/^scenario-[a-z0-9-]+$/),
  category: AttackCategorySchema,
  title: z.string().min(1),
  description: z.string().min(1),
  fixtureId: z.string().min(1),
  originalUserIntent: z.string().min(1),
  untrustedContent: z.string().min(1),
  expectedBehavior: ExpectedBehaviorSchema,
  scriptedSteps: z.array(ScriptedToolStepSchema).min(1),
  stateConditions: z.array(StateConditionSchema),
  deterministicFinalResponse: z.string().min(1),
  controlType: z.enum(["SAFE_CONTROL", "UNSAFE_FIXTURE"]),
  expectedOutcome: z.enum(["PASS", "CANDIDATE_FINDING"]),
  severityIfReproduced: FindingSeveritySchema,
  provenance: z.literal("TEST_FIXTURE"),
});
export type AttackScenario = z.infer<typeof AttackScenarioSchema>;

export const ScenarioResultStatusSchema = z.enum([
  "PASS",
  "CANDIDATE_FINDING",
  "INCONCLUSIVE",
  "EXECUTION_ERROR",
]);
export type ScenarioResultStatus = z.infer<typeof ScenarioResultStatusSchema>;

export const EvaluationViolationSchema = z.object({
  kind: z.enum(["PROHIBITED_TOOL", "PROHIBITED_ARGUMENT", "STATE_CONDITION"]),
  message: z.string().min(1),
  toolName: z.string().min(1).optional(),
  stepIds: z.array(z.string().min(1)),
});
export type EvaluationViolation = z.infer<typeof EvaluationViolationSchema>;

export const BehaviorEvaluationSchema = z.object({
  status: ScenarioResultStatusSchema,
  summary: z.string().min(1),
  violations: z.array(EvaluationViolationSchema),
  unsafeBehaviorFingerprint: z.string().min(1).optional(),
});
export type BehaviorEvaluation = z.infer<typeof BehaviorEvaluationSchema>;

export const StateResetEventSchema = z.object({
  timestamp: z.iso.datetime(),
  reason: z.enum(["INITIAL_EXECUTION", "REPLAY_VERIFICATION"]),
  state: z.json(),
});
export type StateResetEvent = z.infer<typeof StateResetEventSchema>;

export const ScenarioExecutionSchema = z
  .object({
    runId: z.string().min(1),
    scenarioId: z.string().min(1),
    executionId: z.string().min(1),
    traceId: z.string().min(1),
    replayOfExecutionId: z.string().min(1).optional(),
    startedAt: z.iso.datetime(),
    completedAt: z.iso.datetime(),
    resetEvent: StateResetEventSchema,
    baselineCapturedAt: z.iso.datetime(),
    baselineState: z.json(),
    finalState: z.json(),
    finalResponse: z.string().min(1),
    trace: ExecutionTraceSchema,
    observedBehavior: ObservedBehaviorSchema,
    evaluation: BehaviorEvaluationSchema,
  })
  .superRefine((execution, context) => {
    if (execution.trace.id !== execution.traceId) {
      context.addIssue({ code: "custom", message: "Execution traceId must match its embedded trace." });
    }
    for (const field of ["runId", "scenarioId", "executionId"] as const) {
      if (execution.trace[field] !== execution[field]) {
        context.addIssue({ code: "custom", message: `Execution ${field} must match its embedded trace.` });
      }
    }
    if (execution.trace.replayOfExecutionId !== execution.replayOfExecutionId) {
      context.addIssue({
        code: "custom",
        message: "Execution replay linkage must match its embedded trace.",
      });
    }
  });
export type ScenarioExecution = z.infer<typeof ScenarioExecutionSchema>;

export const ScenarioExecutionFailureSchema = z.object({
  runId: z.string().min(1),
  scenarioId: z.string().min(1),
  executionId: z.string().min(1),
  traceId: z.string().min(1),
  replayOfExecutionId: z.string().min(1).optional(),
  phase: z.enum(["RESET", "BASELINE_SNAPSHOT", "BEGIN_EXECUTION", "COMPLETE_EXECUTION", "FINAL_SNAPSHOT"]),
  startedAt: z.iso.datetime(),
  failedAt: z.iso.datetime(),
  summary: z.string().min(1),
});
export type ScenarioExecutionFailure = z.infer<typeof ScenarioExecutionFailureSchema>;

export const ReplayOutcomeSchema = z.enum(["REPRODUCED", "NOT_REPRODUCED", "REPLAY_ERROR"]);
export type ReplayOutcome = z.infer<typeof ReplayOutcomeSchema>;

export const ReplayVerificationSchema = z
  .object({
    outcome: ReplayOutcomeSchema,
    summary: z.string().min(1),
    originalExecutionId: z.string().min(1),
    replayExecutionId: z.string().min(1).optional(),
    replayTraceId: z.string().min(1).optional(),
    replayExecution: ScenarioExecutionSchema.optional(),
  })
  .superRefine((verification, context) => {
    if (
      verification.outcome === "REPRODUCED" &&
      (verification.replayExecutionId === undefined ||
        verification.replayTraceId === undefined ||
        verification.replayExecution === undefined)
    ) {
      context.addIssue({ code: "custom", message: "Reproduced outcomes require complete replay evidence." });
    }
    if (verification.replayExecution !== undefined) {
      if (
        verification.replayExecution.executionId !== verification.replayExecutionId ||
        verification.replayExecution.traceId !== verification.replayTraceId ||
        verification.replayExecution.replayOfExecutionId !== verification.originalExecutionId
      ) {
        context.addIssue({ code: "custom", message: "Replay verification linkage is inconsistent." });
      }
    }
  });
export type ReplayVerification = z.infer<typeof ReplayVerificationSchema>;

export const ToolPolicyRuleSchema = z.object({
  toolName: z.string().min(1),
  disposition: PolicyDispositionSchema,
  allowedContexts: z.array(z.string().min(1)),
  rationale: z.string().min(1),
});
export type ToolPolicyRule = z.infer<typeof ToolPolicyRuleSchema>;

export const ToolPolicySchema = z
  .object({
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    defaultDisposition: PolicyDispositionSchema,
    rules: z.array(ToolPolicyRuleSchema),
    approvalStatus: PolicyApprovalStatusSchema,
    approvedBy: z.string().min(1).optional(),
    approvedAt: z.iso.datetime().optional(),
  })
  .superRefine((policy, context) => {
    const names = new Set<string>();
    policy.rules.forEach((rule, index) => {
      if (names.has(rule.toolName)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate policy rule for ${rule.toolName}.`,
          path: ["rules", index, "toolName"],
        });
      }
      names.add(rule.toolName);
    });

    if (policy.approvalStatus === "APPROVED" && (policy.approvedBy === undefined || policy.approvedAt === undefined)) {
      context.addIssue({
        code: "custom",
        message: "Approved policies require approvedBy and approvedAt.",
        path: ["approvalStatus"],
      });
    }
    if (policy.approvalStatus !== "APPROVED" && (policy.approvedBy !== undefined || policy.approvedAt !== undefined)) {
      context.addIssue({
        code: "custom",
        message: "Only approved policies may contain approval metadata.",
        path: ["approvalStatus"],
      });
    }
  });
export type ToolPolicy = z.infer<typeof ToolPolicySchema>;

export const ReplayResultSchema = z
  .object({
    status: ReproducibilityStatusSchema,
    summary: z.string().min(1),
    attemptedAt: z.iso.datetime().optional(),
    traceId: z.string().min(1).optional(),
  })
  .superRefine((result, context) => {
    if (result.status === "REPRODUCED" && (result.attemptedAt === undefined || result.traceId === undefined)) {
      context.addIssue({
        code: "custom",
        message: "Reproduced replay results require attemptedAt and traceId.",
      });
    }
  });
export type ReplayResult = z.infer<typeof ReplayResultSchema>;

export const RemediationRecommendationSchema = z.object({
  summary: z.string().min(1),
  rationale: z.string().min(1),
  proposedDisposition: PolicyDispositionSchema,
  proposedPolicy: ToolPolicySchema.optional(),
});
export type RemediationRecommendation = z.infer<typeof RemediationRecommendationSchema>;

export const FindingEvidenceSchema = z.object({
  executionTraceId: z.string().min(1),
  replayExecutionTraceId: z.string().min(1),
  stepIds: z.array(z.string().min(1)).min(1),
  replayStepIds: z.array(z.string().min(1)).min(1),
  stateMutationEvidence: z.array(z.string().min(1)).min(1),
  notes: z.array(z.string().min(1)),
  unavailableFields: z.array(z.string().min(1)),
});
export type FindingEvidence = z.infer<typeof FindingEvidenceSchema>;

export const FindingSchema = z.object({
  stableId: z.string().regex(/^finding-[a-z0-9-]+$/),
  scenarioId: z.string().min(1),
  category: AttackCategorySchema,
  targetTool: z.string().min(1),
  severity: FindingSeveritySchema,
  originalUserIntent: z.string().min(1),
  untrustedContent: z.string().min(1),
  toolCallsObserved: z.array(ObservedToolCallSchema).min(1),
  expectedBehavior: ExpectedBehaviorSchema,
  observedBehavior: ObservedBehaviorSchema,
  evidence: FindingEvidenceSchema,
  replayResult: ReplayResultSchema,
  recommendedRemediation: RemediationRecommendationSchema,
  provenance: EvidenceProvenanceSchema,
});
export type Finding = z.infer<typeof FindingSchema>;

export const FindingSeverityCountsSchema = z.object({
  INFO: z.number().int().nonnegative(),
  LOW: z.number().int().nonnegative(),
  MEDIUM: z.number().int().nonnegative(),
  HIGH: z.number().int().nonnegative(),
  CRITICAL: z.number().int().nonnegative(),
});
export type FindingSeverityCounts = z.infer<typeof FindingSeverityCountsSchema>;

export const ToolRiskSummarySchema = z.object({
  toolName: z.string().min(1),
  riskClasses: z.array(ToolRiskSchema),
  approvalNormallyRequired: z.boolean(),
  verifiedFindingCount: z.number().int().nonnegative(),
  highestSeverity: FindingSeveritySchema.optional(),
  deductedPoints: z.number().int().nonnegative(),
});
export type ToolRiskSummary = z.infer<typeof ToolRiskSummarySchema>;

export const SecurityAssessmentSchema = z.object({
  assessedAt: z.iso.datetime(),
  score: z.number().int().min(0).max(100),
  findingCounts: FindingSeverityCountsSchema,
  toolRiskSummary: z.array(ToolRiskSummarySchema),
  findingIds: z.array(z.string().min(1)),
  basedOnVerifiedRuntimeFindingsOnly: z.literal(true),
});
export type SecurityAssessment = z.infer<typeof SecurityAssessmentSchema>;

export const AssessmentCountsSchema = z.object({
  scenariosExecuted: z.number().int().nonnegative(),
  passes: z.number().int().nonnegative(),
  candidates: z.number().int().nonnegative(),
  reproduced: z.number().int().nonnegative(),
  inconclusive: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
});
export type AssessmentCounts = z.infer<typeof AssessmentCountsSchema>;

export const DeterministicAssessmentReportSchema = z.object({
  reportVersion: z.literal("1.0.0"),
  executionMode: z.literal("DETERMINISTIC_LOCAL_DEMO"),
  autonomousAgentExecution: z.literal(false),
  runId: z.string().min(1),
  generatedAt: z.iso.datetime(),
  scenarios: z.array(AttackScenarioSchema),
  executions: z.array(ScenarioExecutionSchema),
  executionFailures: z.array(ScenarioExecutionFailureSchema),
  replayVerifications: z.array(ReplayVerificationSchema),
  verifiedFindings: z.array(FindingSchema),
  counts: AssessmentCountsSchema,
  securityAssessment: SecurityAssessmentSchema,
});
export type DeterministicAssessmentReport = z.infer<typeof DeterministicAssessmentReportSchema>;
