import {
  PolicyChangeSchema,
  PolicyRuleProvenanceSchema,
  ToolPolicySchema,
  type Finding,
  type PolicyChange,
  type PolicyDisposition,
  type PolicyRuleProvenance,
  type TargetTool,
  type ToolPolicy,
  type ToolPolicyRule,
} from "@mcp-breaker/shared";

import { validateToolPolicy } from "./policy.js";

export interface GeneratedRemediationPolicy {
  proposedPolicy: ToolPolicy;
  policyDiff: PolicyChange[];
  provenance: PolicyRuleProvenance[];
}

function explicitRule(policy: ToolPolicy, toolName: string): ToolPolicyRule | undefined {
  return policy.rules.find((rule) => rule.toolName === toolName);
}

function effectiveDisposition(policy: ToolPolicy, toolName: string): PolicyDisposition {
  return explicitRule(policy, toolName)?.disposition ?? policy.defaultDisposition;
}

function assertValidPolicy(input: unknown, tools: readonly TargetTool[], label: string): ToolPolicy {
  const validation = validateToolPolicy(input, [...tools]);
  if (!validation.valid || validation.policy === undefined) {
    const detail = validation.issues.map((issue) => issue.message).join(" ");
    throw new Error(`${label} policy is invalid and cannot be used. ${detail}`.trim());
  }
  return validation.policy;
}

export function deriveCurrentDemoPolicy(tools: readonly TargetTool[]): ToolPolicy {
  const policy = ToolPolicySchema.parse({
    version: "1.0.0",
    defaultDisposition: "DENY",
    approvalStatus: "DRAFT",
    rules: tools.map((tool) => ({
      toolName: tool.name,
      disposition: "ALLOW",
      allowedContexts: tool.expectedAllowedContexts,
      rationale: "The intentionally vulnerable local fixture currently executes this known demo tool without policy enforcement.",
    })),
  });
  return assertValidPolicy(policy, tools, "Current demo");
}

function proposedDisposition(tool: TargetTool, findings: readonly Finding[]): PolicyDisposition {
  if (tool.riskClasses.length === 1 && tool.riskClasses[0] === "READ_ONLY") {
    return "ALLOW";
  }
  if (tool.riskClasses.includes("CODE_EXECUTION")) {
    return "SANDBOX_ONLY";
  }
  if (tool.riskClasses.includes("DESTRUCTIVE")) {
    return "REQUIRE_APPROVAL";
  }
  if (findings.length === 0) {
    return "ALLOW";
  }
  if (
    tool.riskClasses.includes("WRITE") ||
    tool.riskClasses.includes("PRIVILEGED") ||
    (tool.riskClasses.includes("EXTERNAL_COMMUNICATION") &&
      findings.some((finding) =>
        ["UNAUTHORIZED_WRITE", "CONFUSED_DEPUTY", "INDIRECT_PROMPT_INJECTION"].includes(finding.category),
      ))
  ) {
    return "REQUIRE_APPROVAL";
  }
  return "ALLOW";
}

function rationaleFor(tool: TargetTool, findings: readonly Finding[], disposition: PolicyDisposition): string {
  const findingIds = findings.map((finding) => finding.stableId);
  if (disposition === "ALLOW") {
    return tool.riskClasses.includes("READ_ONLY")
      ? "Read-only functionality remains available so the deterministic agent can continue authorized inspection tasks."
      : "No reproduced runtime finding currently motivates restricting this known local demo tool."
  }
  if (disposition === "SANDBOX_ONLY") {
    return "Code execution is restricted to the explicitly declared disposable local sandbox boundary."
  }
  if (findingIds.length > 0) {
    return `${findingIds.join(", ")} reproduced an unauthorized ${tool.name} action; execution now requires explicit approval.`;
  }
  return `${tool.name} is destructive and requires explicit approval even though no current finding directly implicated it.`;
}

export function describePolicyProvenance(input: {
  currentPolicy: ToolPolicy;
  proposedPolicy: ToolPolicy;
  findings: readonly Finding[];
  tools: readonly TargetTool[];
}): PolicyRuleProvenance[] {
  return input.tools.map((tool) => {
    const related = input.findings.filter((finding) => finding.targetTool === tool.name);
    const current = effectiveDisposition(input.currentPolicy, tool.name);
    const proposed = effectiveDisposition(input.proposedPolicy, tool.name);
    const proposedRule = explicitRule(input.proposedPolicy, tool.name);
    return PolicyRuleProvenanceSchema.parse({
      toolName: tool.name,
      currentDisposition: current,
      proposedDisposition: proposed,
      reason: proposedRule?.rationale ?? rationaleFor(tool, related, proposed),
      relatedFindingIds: related.map((finding) => finding.stableId),
      riskClasses: tool.riskClasses,
      changed: current !== proposed,
    });
  });
}

export function generateRemediationPolicy(input: {
  currentPolicy: ToolPolicy;
  findings: readonly Finding[];
  tools: readonly TargetTool[];
}): GeneratedRemediationPolicy {
  const currentPolicy = assertValidPolicy(input.currentPolicy, input.tools, "Current");
  const rules = input.tools.map((tool) => {
    const related = input.findings.filter((finding) => finding.targetTool === tool.name);
    const disposition = proposedDisposition(tool, related);
    return {
      toolName: tool.name,
      disposition,
      allowedContexts:
        disposition === "DENY"
          ? []
          : disposition === "SANDBOX_ONLY"
            ? ["Disposable local sandbox/test boundary only."]
            : tool.expectedAllowedContexts,
      rationale: rationaleFor(tool, related, disposition),
    };
  });
  const proposedPolicy = assertValidPolicy(
    ToolPolicySchema.parse({
      version: "2.0.0",
      defaultDisposition: "DENY",
      approvalStatus: "PROPOSED",
      rules,
    }),
    input.tools,
    "Proposed",
  );
  const provenance = describePolicyProvenance({
    currentPolicy,
    proposedPolicy,
    findings: input.findings,
    tools: input.tools,
  });
  return {
    proposedPolicy,
    provenance,
    policyDiff: provenance.filter((entry) => entry.changed).map((entry) => PolicyChangeSchema.parse(entry)),
  };
}

export function validatePolicyOrThrow(input: unknown, tools: readonly TargetTool[], label = "Proposed"): ToolPolicy {
  return assertValidPolicy(input, tools, label);
}
