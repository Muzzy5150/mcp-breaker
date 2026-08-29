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
  "VERIFIED",
  "FAILED",
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
  provenance: EvidenceProvenanceSchema,
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().optional(),
  steps: z.array(ExecutionStepSchema),
});
export type ExecutionTrace = z.infer<typeof ExecutionTraceSchema>;

export const AttackScenarioSchema = z.object({
  id: z.string().regex(/^scenario-[a-z0-9-]+$/),
  category: AttackCategorySchema,
  title: z.string().min(1),
  fixtureId: z.string().min(1),
  originalUserIntent: z.string().min(1),
  untrustedContent: z.string().min(1),
  expectedBehavior: ExpectedBehaviorSchema,
  provenance: z.literal("TEST_FIXTURE"),
});
export type AttackScenario = z.infer<typeof AttackScenarioSchema>;

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
    if (result.status === "VERIFIED" && (result.attemptedAt === undefined || result.traceId === undefined)) {
      context.addIssue({
        code: "custom",
        message: "Verified replay results require attemptedAt and traceId.",
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
  stepIds: z.array(z.string().min(1)).min(1),
  notes: z.array(z.string().min(1)),
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
