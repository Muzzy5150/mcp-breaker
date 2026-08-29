import {
  FindingSchema,
  SecurityAssessmentSchema,
  TargetToolSchema,
  type Finding,
  type FindingSeverity,
  type FindingSeverityCounts,
  type SecurityAssessment,
  type TargetTool,
} from "@mcp-breaker/shared";

export const SEVERITY_DEDUCTIONS: Readonly<Record<FindingSeverity, number>> = Object.freeze({
  INFO: 0,
  LOW: 5,
  MEDIUM: 10,
  HIGH: 20,
  CRITICAL: 35,
});

const severityRank: Readonly<Record<FindingSeverity, number>> = Object.freeze({
  INFO: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
});

function emptyCounts(): FindingSeverityCounts {
  return { INFO: 0, LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
}

function highestSeverity(findings: Finding[]): FindingSeverity | undefined {
  return findings.reduce<FindingSeverity | undefined>((highest, finding) => {
    if (highest === undefined || severityRank[finding.severity] > severityRank[highest]) {
      return finding.severity;
    }
    return highest;
  }, undefined);
}

interface ScoreSecurityAssessmentInput {
  findings: Finding[];
  targetTools: TargetTool[];
  assessedAt?: string;
}

export function scoreSecurityAssessment(input: ScoreSecurityAssessmentInput): SecurityAssessment {
  const findings = input.findings.map((finding) => FindingSchema.parse(finding));
  const targetTools = input.targetTools.map((tool) => TargetToolSchema.parse(tool));
  const toolNames = new Set<string>();
  for (const tool of targetTools) {
    if (toolNames.has(tool.name)) {
      throw new Error(`Duplicate target tool: ${tool.name}`);
    }
    toolNames.add(tool.name);
  }
  const ids = new Set<string>();
  for (const finding of findings) {
    if (ids.has(finding.stableId)) {
      throw new Error(`Duplicate finding ID: ${finding.stableId}`);
    }
    ids.add(finding.stableId);
  }

  const includedFindings = findings.filter(
    (finding) => finding.provenance === "RUNTIME" && finding.replayResult.status === "VERIFIED",
  );
  for (const finding of includedFindings) {
    if (!toolNames.has(finding.targetTool)) {
      throw new Error(`Verified finding references unknown target tool: ${finding.targetTool}`);
    }
  }
  const counts = emptyCounts();
  let totalDeduction = 0;
  for (const finding of includedFindings) {
    counts[finding.severity] += 1;
    totalDeduction += SEVERITY_DEDUCTIONS[finding.severity];
  }

  const toolRiskSummary = targetTools
    .map((tool) => {
      const toolFindings = includedFindings.filter((finding) => finding.targetTool === tool.name);
      const deductedPoints = toolFindings.reduce(
        (total, finding) => total + SEVERITY_DEDUCTIONS[finding.severity],
        0,
      );
      const severity = highestSeverity(toolFindings);
      return {
        toolName: tool.name,
        riskClasses: tool.riskClasses,
        approvalNormallyRequired: tool.approvalNormallyRequired,
        verifiedFindingCount: toolFindings.length,
        ...(severity === undefined ? {} : { highestSeverity: severity }),
        deductedPoints,
      };
    })
    .sort((left, right) => left.toolName.localeCompare(right.toolName));

  return SecurityAssessmentSchema.parse({
    assessedAt: input.assessedAt ?? new Date().toISOString(),
    score: Math.max(0, 100 - totalDeduction),
    findingCounts: counts,
    toolRiskSummary,
    findingIds: includedFindings.map((finding) => finding.stableId).sort(),
    basedOnVerifiedRuntimeFindingsOnly: true,
  });
}
