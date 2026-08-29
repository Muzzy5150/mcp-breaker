import { TraceRecorder } from "@mcp-breaker/breaker-core";
import type { EvidenceProvenance, ExecutionTrace } from "@mcp-breaker/shared";
import { z } from "zod";

import { getDemoToolMetadata, type DemoToolName } from "./metadata.js";
import { DemoStateStore } from "./state.js";

const virtualPathPattern = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
export const VirtualDemoPathSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(virtualPathPattern, "Path must be a relative virtual demo path.")
  .refine((path) => path.split("/").every((segment) => segment !== "." && segment !== ".."), {
    message: "Path traversal is not allowed.",
  });

export const DemoToolInputSchemas = {
  list_issues: z.object({ repositoryId: z.string().min(1).optional() }),
  read_issue: z.object({ issueNumber: z.number().int().positive() }),
  read_pull_request: z.object({ pullRequestNumber: z.number().int().positive() }),
  read_file: z.object({ path: VirtualDemoPathSchema }),
  list_files: z.object({ prefix: VirtualDemoPathSchema.optional() }),
  write_file: z.object({ path: VirtualDemoPathSchema, content: z.string().max(100_000) }),
  delete_file: z.object({ path: VirtualDemoPathSchema }),
  create_pull_request: z.object({
    title: z.string().min(1).max(200),
    description: z.string().max(10_000),
    sourceBranch: z.string().min(1).max(200),
    targetBranch: z.string().min(1).max(200),
  }),
  merge_pull_request: z.object({ pullRequestNumber: z.number().int().positive() }),
  send_message: z.object({ channel: z.string().regex(/^#[a-z0-9-]+$/), body: z.string().min(1).max(10_000) }),
  reset_demo_state: z.object({ confirmation: z.literal("RESET_DEMO_STATE") }),
} as const;

const DemoIssueSchema = z.object({
  number: z.number().int().positive(),
  repositoryId: z.string().min(1),
  title: z.string(),
  body: z.string(),
  status: z.enum(["OPEN", "CLOSED"]),
  fixtureId: z.string().min(1).optional(),
});

const DemoPullRequestSchema = z.object({
  number: z.number().int().positive(),
  repositoryId: z.string().min(1),
  title: z.string(),
  description: z.string(),
  sourceBranch: z.string(),
  targetBranch: z.string(),
  status: z.enum(["OPEN", "MERGED"]),
  mergedAt: z.iso.datetime().optional(),
  fixtureId: z.string().min(1).optional(),
});

const DemoFileSchema = z.object({
  path: VirtualDemoPathSchema,
  content: z.string(),
  classification: z.enum(["TEMPORARY", "DEMO_CUSTOMER_DATA", "SOURCE"]),
});

const DemoMessageSchema = z.object({
  id: z.string().min(1),
  channel: z.string().regex(/^#[a-z0-9-]+$/),
  body: z.string(),
  sentAt: z.iso.datetime(),
});

/** Exact MCP result contracts advertised to live agent runtimes. */
export const DemoToolOutputSchemas = {
  list_issues: z.object({ issues: z.array(DemoIssueSchema) }),
  read_issue: z.object({ issue: DemoIssueSchema }),
  read_pull_request: z.object({ pullRequest: DemoPullRequestSchema }),
  read_file: z.object({ file: DemoFileSchema }),
  list_files: z.object({ files: z.array(DemoFileSchema) }),
  write_file: z.object({ file: DemoFileSchema, created: z.boolean() }),
  delete_file: z.object({ deleted: DemoFileSchema }),
  create_pull_request: z.object({ pullRequest: DemoPullRequestSchema }),
  merge_pull_request: z.object({ pullRequest: DemoPullRequestSchema }),
  send_message: z.object({ message: DemoMessageSchema }),
  reset_demo_state: z.object({
    reset: z.literal(true),
    counts: z.object({
      issues: z.number().int().nonnegative(),
      pullRequests: z.number().int().nonnegative(),
      files: z.number().int().nonnegative(),
      messages: z.number().int().nonnegative(),
    }),
  }),
} as const;

export interface DemoToolCallContext {
  traceId: string;
}

export interface StandaloneDemoToolCallContext {
  sessionId: string;
  testId: string;
  provenance: EvidenceProvenance;
}

export interface StandaloneDemoToolCallResult {
  result: unknown;
  trace: ExecutionTrace;
}

export class DemoToolService {
  readonly state: DemoStateStore;
  readonly traces: TraceRecorder;

  constructor(state = new DemoStateStore(), traces = new TraceRecorder()) {
    this.state = state;
    this.traces = traces;
  }

  async invoke(toolName: DemoToolName, rawArguments: unknown, context: DemoToolCallContext): Promise<unknown> {
    await Promise.resolve();
    const metadata = getDemoToolMetadata(toolName);
    const readOnly = metadata.riskClasses.length === 1 && metadata.riskClasses[0] === "READ_ONLY";
    const stateBefore = readOnly ? undefined : this.state.snapshot();

    try {
      const result = this.#execute(toolName, rawArguments);
      this.traces.recordStep({
        traceId: context.traceId,
        toolName,
        arguments: rawArguments,
        ...(stateBefore === undefined ? {} : { stateBefore }),
        result,
        ...(stateBefore === undefined ? {} : { stateAfter: this.state.snapshot() }),
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.traces.recordStep({
        traceId: context.traceId,
        toolName,
        arguments: rawArguments,
        ...(stateBefore === undefined ? {} : { stateBefore }),
        error: message,
        ...(stateBefore === undefined ? {} : { stateAfter: this.state.snapshot() }),
      });
      throw error;
    }
  }

  async invokeStandalone(
    toolName: DemoToolName,
    rawArguments: unknown,
    context: StandaloneDemoToolCallContext,
  ): Promise<StandaloneDemoToolCallResult> {
    const trace = this.traces.beginTrace(context);
    try {
      const result = await this.invoke(toolName, rawArguments, { traceId: trace.id });
      return { result, trace: this.traces.completeTrace(trace.id) };
    } catch (error) {
      this.traces.completeTrace(trace.id);
      throw error;
    }
  }

  #execute(toolName: DemoToolName, rawArguments: unknown): unknown {
    switch (toolName) {
      case "list_issues": {
        const input = DemoToolInputSchemas.list_issues.parse(rawArguments);
        return { issues: this.state.listIssues(input.repositoryId) };
      }
      case "read_issue": {
        const input = DemoToolInputSchemas.read_issue.parse(rawArguments);
        return { issue: this.state.readIssue(input.issueNumber) };
      }
      case "read_pull_request": {
        const input = DemoToolInputSchemas.read_pull_request.parse(rawArguments);
        return { pullRequest: this.state.readPullRequest(input.pullRequestNumber) };
      }
      case "read_file": {
        const input = DemoToolInputSchemas.read_file.parse(rawArguments);
        return { file: this.state.readFile(input.path) };
      }
      case "list_files": {
        const input = DemoToolInputSchemas.list_files.parse(rawArguments);
        return { files: this.state.listFiles(input.prefix) };
      }
      case "write_file": {
        const input = DemoToolInputSchemas.write_file.parse(rawArguments);
        return this.state.writeFile(input.path, input.content);
      }
      case "delete_file": {
        const input = DemoToolInputSchemas.delete_file.parse(rawArguments);
        return { deleted: this.state.deleteFile(input.path) };
      }
      case "create_pull_request": {
        const input = DemoToolInputSchemas.create_pull_request.parse(rawArguments);
        return { pullRequest: this.state.createPullRequest(input) };
      }
      case "merge_pull_request": {
        const input = DemoToolInputSchemas.merge_pull_request.parse(rawArguments);
        return { pullRequest: this.state.mergePullRequest(input.pullRequestNumber) };
      }
      case "send_message": {
        const input = DemoToolInputSchemas.send_message.parse(rawArguments);
        return { message: this.state.sendMessage(input.channel, input.body) };
      }
      case "reset_demo_state": {
        DemoToolInputSchemas.reset_demo_state.parse(rawArguments);
        const state = this.state.reset();
        return {
          reset: true,
          counts: {
            issues: state.issues.length,
            pullRequests: state.pullRequests.length,
            files: Object.keys(state.files).length,
            messages: state.messages.length,
          },
        };
      }
    }
  }
}
