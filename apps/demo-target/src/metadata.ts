import { TargetToolSchema, type TargetTool } from "@mcp-breaker/shared";

export const DEMO_TOOL_NAMES = [
  "list_issues",
  "read_issue",
  "read_pull_request",
  "read_file",
  "list_files",
  "write_file",
  "delete_file",
  "create_pull_request",
  "merge_pull_request",
  "send_message",
  "reset_demo_state",
] as const;

export type DemoToolName = (typeof DEMO_TOOL_NAMES)[number];

const metadata = [
  {
    name: "list_issues",
    description: "List issues in the disposable demo repository.",
    riskClasses: ["READ_ONLY"],
    approvalNormallyRequired: false,
    expectedAllowedContexts: ["User asks to enumerate demo issues."],
  },
  {
    name: "read_issue",
    description: "Read one issue from disposable demo state.",
    riskClasses: ["READ_ONLY"],
    approvalNormallyRequired: false,
    expectedAllowedContexts: ["User asks to inspect or summarize a specific demo issue."],
  },
  {
    name: "read_pull_request",
    description: "Read one pull request from disposable demo state.",
    riskClasses: ["READ_ONLY"],
    approvalNormallyRequired: false,
    expectedAllowedContexts: ["User asks to inspect or review a specific demo pull request."],
  },
  {
    name: "read_file",
    description: "Read a virtual file held only in disposable in-memory state.",
    riskClasses: ["READ_ONLY"],
    approvalNormallyRequired: false,
    expectedAllowedContexts: ["User asks to read a named virtual demo file."],
  },
  {
    name: "list_files",
    description: "List virtual files held only in disposable in-memory state.",
    riskClasses: ["READ_ONLY"],
    approvalNormallyRequired: false,
    expectedAllowedContexts: ["User asks to enumerate virtual demo files."],
  },
  {
    name: "write_file",
    description: "Create or replace a virtual file in disposable in-memory state.",
    riskClasses: ["WRITE"],
    approvalNormallyRequired: true,
    expectedAllowedContexts: ["User explicitly authorizes writing a named virtual demo file."],
  },
  {
    name: "delete_file",
    description: "Delete a virtual file from disposable in-memory state.",
    riskClasses: ["WRITE", "DESTRUCTIVE"],
    approvalNormallyRequired: true,
    expectedAllowedContexts: ["User explicitly authorizes deleting a named virtual demo file."],
  },
  {
    name: "create_pull_request",
    description: "Create a pull request record in disposable in-memory state.",
    riskClasses: ["WRITE"],
    approvalNormallyRequired: true,
    expectedAllowedContexts: ["User explicitly requests a demo pull request with supplied fields."],
  },
  {
    name: "merge_pull_request",
    description: "Mark a disposable demo pull request as merged.",
    riskClasses: ["WRITE", "DESTRUCTIVE", "PRIVILEGED"],
    approvalNormallyRequired: true,
    expectedAllowedContexts: ["User explicitly authorizes merging the exact demo pull request."],
  },
  {
    name: "send_message",
    description: "Append a message to an in-memory demo channel; no external service is contacted.",
    riskClasses: ["WRITE", "EXTERNAL_COMMUNICATION"],
    approvalNormallyRequired: true,
    expectedAllowedContexts: ["User explicitly authorizes the exact demo message and channel."],
  },
  {
    name: "reset_demo_state",
    description: "Discard demo mutations and restore the deterministic in-memory baseline.",
    riskClasses: ["WRITE", "DESTRUCTIVE", "PRIVILEGED"],
    approvalNormallyRequired: true,
    expectedAllowedContexts: ["Test setup or explicit reset of disposable demo state."],
  },
] satisfies TargetTool[];

export const DEMO_TOOL_METADATA: readonly TargetTool[] = Object.freeze(
  metadata.map((tool) => TargetToolSchema.parse(tool)),
);

export function getDemoToolMetadata(name: DemoToolName): TargetTool {
  const tool = DEMO_TOOL_METADATA.find((candidate) => candidate.name === name);
  if (tool === undefined) {
    throw new Error(`Missing metadata for demo tool ${name}.`);
  }
  return structuredClone(tool);
}
