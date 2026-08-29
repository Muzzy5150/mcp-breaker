import {
  ToolPolicySchema,
  type PolicyDisposition,
  type TargetTool,
  type ToolPolicy,
  type ToolPolicyRule,
} from "@mcp-breaker/shared";

export interface PolicyValidationIssue {
  level: "ERROR" | "WARNING";
  message: string;
  toolName?: string;
}

export interface PolicyValidationResult {
  valid: boolean;
  policy?: ToolPolicy;
  issues: PolicyValidationIssue[];
}

export interface PolicyDifference {
  toolName: string;
  change: "ADDED" | "REMOVED" | "CHANGED";
  currentDisposition?: PolicyDisposition;
  proposedDisposition?: PolicyDisposition;
  explanation: string;
}

function rulesByName(rules: ToolPolicyRule[]): Map<string, ToolPolicyRule> {
  return new Map(rules.map((rule) => [rule.toolName, rule]));
}

export function validateToolPolicy(input: unknown, targetTools: TargetTool[]): PolicyValidationResult {
  const parsed = ToolPolicySchema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      issues: parsed.error.issues.map((issue) => ({
        level: "ERROR",
        message: issue.message,
      })),
    };
  }

  const knownTools = new Map(targetTools.map((tool) => [tool.name, tool]));
  const issues: PolicyValidationIssue[] = [];
  for (const rule of parsed.data.rules) {
    const tool = knownTools.get(rule.toolName);
    if (tool === undefined) {
      issues.push({ level: "ERROR", toolName: rule.toolName, message: "Policy references an unknown tool." });
      continue;
    }
    if (rule.disposition === "ALLOW" && tool.approvalNormallyRequired && rule.allowedContexts.length === 0) {
      issues.push({
        level: "ERROR",
        toolName: rule.toolName,
        message: "A normally gated tool cannot be unconditionally allowed without an explicit context.",
      });
    }
    if (rule.disposition === "DENY" && tool.riskClasses.length === 1 && tool.riskClasses[0] === "READ_ONLY") {
      issues.push({
        level: "WARNING",
        toolName: rule.toolName,
        message: "A read-only tool is denied; confirm this restriction is intentional.",
      });
    }
  }

  return {
    valid: !issues.some((issue) => issue.level === "ERROR"),
    policy: parsed.data,
    issues,
  };
}

export function compareToolPolicies(current: ToolPolicy, proposed: ToolPolicy): PolicyDifference[] {
  const currentRules = rulesByName(current.rules);
  const proposedRules = rulesByName(proposed.rules);
  const toolNames = [...new Set([...currentRules.keys(), ...proposedRules.keys()])].sort();
  const differences: PolicyDifference[] = [];

  for (const toolName of toolNames) {
    const currentRule = currentRules.get(toolName);
    const proposedRule = proposedRules.get(toolName);
    if (currentRule === undefined && proposedRule !== undefined) {
      differences.push({
        toolName,
        change: "ADDED",
        proposedDisposition: proposedRule.disposition,
        explanation: `${toolName} receives an explicit ${proposedRule.disposition} rule.`,
      });
      continue;
    }
    if (currentRule !== undefined && proposedRule === undefined) {
      differences.push({
        toolName,
        change: "REMOVED",
        currentDisposition: currentRule.disposition,
        explanation: `${toolName} falls back to the proposed default ${proposed.defaultDisposition}.`,
      });
      continue;
    }
    if (currentRule !== undefined && proposedRule !== undefined) {
      const contextsChanged = JSON.stringify(currentRule.allowedContexts) !== JSON.stringify(proposedRule.allowedContexts);
      if (currentRule.disposition !== proposedRule.disposition || contextsChanged) {
        differences.push({
          toolName,
          change: "CHANGED",
          currentDisposition: currentRule.disposition,
          proposedDisposition: proposedRule.disposition,
          explanation: `${toolName} changes from ${currentRule.disposition} to ${proposedRule.disposition}.`,
        });
      }
    }
  }

  if (current.defaultDisposition !== proposed.defaultDisposition) {
    differences.unshift({
      toolName: "@default",
      change: "CHANGED",
      currentDisposition: current.defaultDisposition,
      proposedDisposition: proposed.defaultDisposition,
      explanation: `The default disposition changes from ${current.defaultDisposition} to ${proposed.defaultDisposition}.`,
    });
  }
  return differences;
}

export function explainPolicyComparison(differences: PolicyDifference[]): string {
  if (differences.length === 0) {
    return "The proposed policy makes no effective tool-disposition changes.";
  }
  return differences.map((difference) => difference.explanation).join(" ");
}
