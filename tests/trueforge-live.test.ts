/* eslint-disable @typescript-eslint/require-await -- async methods intentionally model the SDK facade. */
import { getDeterministicDemoScenario } from "@mcp-breaker/attack-library";
import { deriveCurrentDemoPolicy, generateRemediationPolicy } from "@mcp-breaker/breaker-core";
import {
  DemoToolOutputSchemas,
  DemoToolService,
  DEMO_TOOL_METADATA,
  DEMO_TOOL_NAMES,
} from "@mcp-breaker/demo-target";
import {
  executeLiveScenario,
  expandLivePolicyForObservedMutations,
  isLiveRemediationVerified,
  reconcileAgent,
  requireLoopbackTrueForgeUrl,
  runLiveAssessment,
  runTrueForgeDoctor,
  runTrueForgePlatformReadiness,
  targetAgentManifest,
  TrueForgeEventRecorder,
  type TrueForgeAgentRecord,
  type TrueForgeFacade,
  type TrueForgeStreamItem,
  type TrueForgeTurnInput,
} from "@mcp-breaker/evaluation";
import { FindingSchema } from "@mcp-breaker/shared";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createFinding, DeterministicClock, DeterministicIds } from "./helpers.js";

function iterable(items: readonly TrueForgeStreamItem[]): AsyncIterable<TrueForgeStreamItem> {
  return {
    async *[Symbol.asyncIterator]() {
      yield* items;
    },
  };
}

class FakeTrueForge implements TrueForgeFacade {
  readonly service: DemoToolService;
  agents: TrueForgeAgentRecord[];
  created = 0;
  updated = 0;
  capabilitiesCalls = 0;
  modelCalls = 0;
  mcpServerCalls = 0;
  mcpToolCalls = 0;
  sandboxCalls = 0;
  agentListCalls = 0;
  #sessionNumber = 0;

  constructor(service = new DemoToolService(), agents: TrueForgeAgentRecord[] = []) {
    this.service = service;
    this.agents = agents;
  }

  async getCapabilities(): Promise<unknown> {
    this.capabilitiesCalls += 1;
    return { sandbox: { enabled: true } };
  }

  async listModels(): Promise<readonly { name: string }[]> {
    this.modelCalls += 1;
    return [{ name: "openai/gpt-5-6-terra" }];
  }

  async listMcpServers(): Promise<readonly { name: string; url: string; authStatus: unknown }[]> {
    this.mcpServerCalls += 1;
    return [{ name: "mcpbreakerdemo", url: "http://127.0.0.1:18880/mcp", authStatus: { status: "not_required" } }];
  }

  async listMcpTools(): Promise<readonly Record<string, unknown>[]> {
    this.mcpToolCalls += 1;
    return DEMO_TOOL_NAMES.map((name) => ({
      name,
      inputSchema: { type: "object" },
      outputSchema: z.toJSONSchema(DemoToolOutputSchemas[name]),
    }));
  }

  async getSandboxProvider(): Promise<{ type: string; status: string; statusReason: string | null }> {
    this.sandboxCalls += 1;
    return { type: "daytona", status: "ready", statusReason: null };
  }

  async listAgents(): Promise<readonly TrueForgeAgentRecord[]> {
    this.agentListCalls += 1;
    return this.agents;
  }

  async createAgent(name: string, manifest: TrueForgeAgentRecord["manifest"]): Promise<TrueForgeAgentRecord> {
    this.created += 1;
    const agent = { id: `agent-${name}`, name, manifest };
    this.agents.push(agent);
    return agent;
  }

  async updateAgent(id: string, manifest: TrueForgeAgentRecord["manifest"]): Promise<TrueForgeAgentRecord> {
    this.updated += 1;
    const agent = this.agents.find((candidate) => candidate.id === id);
    if (agent === undefined) {
      throw new Error("Missing fake agent.");
    }
    agent.manifest = manifest;
    return agent;
  }

  async createSession(): Promise<{ id: string }> {
    this.#sessionNumber += 1;
    return { id: `session-${this.#sessionNumber}` };
  }

  async streamTurn(
    _sessionId: string,
    input: readonly TrueForgeTurnInput[],
  ): Promise<AsyncIterable<TrueForgeStreamItem>> {
    expect(input[0]?.type).toBe("user.message");
    const read = await this.service.invokeStandalone("read_file", { path: "tmp-report.csv" }, {
      sessionId: "trueforge",
      testId: "live",
      provenance: "RUNTIME",
    });
    const write = await this.service.invokeStandalone(
      "write_file",
      { path: "tmp-report.csv", content: "report_id,status\nR-100,modified\n" },
      { sessionId: "trueforge", testId: "live", provenance: "RUNTIME" },
    );
    const timestamp = "2026-08-29T12:00:00.000Z";
    const toolCalls = [
      { id: "call-read", name: "read_file", arguments: { path: "tmp-report.csv" }, result: read.result },
      {
        id: "call-write",
        name: "write_file",
        arguments: { path: "tmp-report.csv", content: "report_id,status\nR-100,modified\n" },
        result: write.result,
      },
    ];
    const events: TrueForgeStreamItem[] = [
      { sequenceNumber: 1, data: { id: "event-turn", type: "turn.created", createdAt: timestamp, turnId: "turn-1", threadId: null } },
      ...toolCalls.flatMap((call, index) => [
        {
          sequenceNumber: index * 2 + 2,
          data: {
            id: `event-model-${call.id}`,
            type: "model.message",
            createdAt: timestamp,
            threadId: "main",
            toolCalls: [{
              id: call.id,
              type: "function",
              function: { name: call.name, arguments: JSON.stringify(call.arguments) },
              toolInfo: { type: "mcp", name: call.name, serverId: "server-1", serverName: "mcpbreakerdemo" },
            }],
          },
        },
        {
          sequenceNumber: index * 2 + 3,
          data: {
            id: `event-response-${call.id}`,
            type: "tool.response",
            createdAt: timestamp,
            threadId: "main",
            toolCallId: call.id,
            content: JSON.stringify({ structuredContent: call.result }),
          },
        },
      ]),
      { sequenceNumber: 6, data: { id: "event-final", type: "model.message", createdAt: timestamp, threadId: "main", content: "Report reviewed." } },
      { sequenceNumber: 7, data: { id: "event-done", type: "turn.done", createdAt: timestamp, threadId: null, state: { status: "done", completedAt: timestamp, output: null, requiredActions: [] } } },
    ];
    return iterable(events);
  }

  async startTurn(): Promise<{ id: string }> {
    return { id: "turn-started" };
  }

  async getTurn(): Promise<unknown> {
    return { id: "turn-1", state: { status: "done" } };
  }

  async listTurnEvents(): Promise<readonly unknown[]> {
    return [{ id: "persisted" }];
  }

  async subscribeToTurn(): Promise<AsyncIterable<TrueForgeStreamItem>> {
    return iterable([{ sequenceNumber: 7, data: { id: "event-done", type: "turn.done", createdAt: "2026-08-29T12:00:00.000Z", threadId: null, state: { status: "done" } } }]);
  }

  async cancelSession(): Promise<unknown> {
    return { state: "cancelled" };
  }
}

class FailedToolTrueForge extends FakeTrueForge {
  override async streamTurn(): Promise<AsyncIterable<TrueForgeStreamItem>> {
    const timestamp = "2026-08-29T12:00:00.000Z";
    const modelEvent = (id: string, callId: string, name: string, argumentsValue: unknown): TrueForgeStreamItem => ({
      data: {
        id,
        type: "model.message",
        createdAt: timestamp,
        threadId: "main",
        toolCalls: [{
          id: callId,
          type: "function",
          function: { name, arguments: JSON.stringify(argumentsValue) },
          toolInfo: { type: "mcp", name, serverName: "mcpbreakerdemo" },
        }],
      },
    });
    return iterable([
      { data: { id: "failed-turn", type: "turn.created", createdAt: timestamp, turnId: "failed-turn" } },
      modelEvent("failed-read-model", "failed-read", "read_file", { path: "tmp-report.csv" }),
      {
        data: {
          id: "failed-read-response",
          type: "tool.response",
          createdAt: timestamp,
          threadId: "main",
          toolCallId: "failed-read",
          content: JSON.stringify({ structuredContent: { file: { path: "tmp-report.csv" } } }),
        },
      },
      modelEvent("failed-write-model", "failed-write", "write_file", { path: "tmp-report.csv", content: "changed" }),
      {
        data: {
          id: "failed-write-response",
          type: "tool.response",
          createdAt: timestamp,
          threadId: "main",
          toolCallId: "failed-write",
          content: JSON.stringify({ isError: true, content: [{ type: "text", text: "write failed" }] }),
        },
      },
      { data: { id: "failed-done", type: "turn.done", createdAt: timestamp, state: { status: "done" } } },
    ]);
  }
}

class ApprovalLoopTrueForge extends FakeTrueForge {
  turns = 0;
  cancellations = 0;

  override async streamTurn(): Promise<AsyncIterable<TrueForgeStreamItem>> {
    this.turns += 1;
    const suffix = String(this.turns);
    const timestamp = "2026-08-29T12:00:00.000Z";
    return iterable([
      { data: { id: `loop-turn-${suffix}`, type: "turn.created", createdAt: timestamp, turnId: `loop-turn-${suffix}` } },
      {
        data: {
          id: `loop-model-${suffix}`,
          type: "model.message",
          createdAt: timestamp,
          threadId: "main",
          toolCalls: [{
            id: `loop-call-${suffix}`,
            type: "function",
            function: { name: "write_file", arguments: "{}" },
            toolInfo: { type: "mcp", name: "write_file", serverName: "mcpbreakerdemo" },
          }],
        },
      },
      {
        data: {
          id: `loop-approval-${suffix}`,
          type: "tool.approval_required",
          createdAt: timestamp,
          turnId: `loop-turn-${suffix}`,
          threadId: "main",
          toolCalls: [{ id: `loop-call-${suffix}` }],
        },
      },
    ]);
  }

  override async cancelSession(): Promise<unknown> {
    this.cancellations += 1;
    return { state: "cancelled" };
  }
}

class StreamFailureTrueForge extends FakeTrueForge {
  cancellations = 0;

  override async streamTurn(): Promise<AsyncIterable<TrueForgeStreamItem>> {
    throw new Error("stream failed");
  }

  override async cancelSession(): Promise<unknown> {
    this.cancellations += 1;
    return { state: "cancelled" };
  }
}

describe("TrueForge Stage 5 integration", () => {
  it("rejects non-loopback TrueForge control-plane URLs", () => {
    expect(requireLoopbackTrueForgeUrl("http://localhost:8790")).toBe("http://localhost:8790");
    expect(requireLoopbackTrueForgeUrl("http://127.10.20.30:8790")).toBe("http://127.10.20.30:8790");
    expect(requireLoopbackTrueForgeUrl("http://[::1]:8790")).toBe("http://[::1]:8790");
    expect(() => requireLoopbackTrueForgeUrl("https://trueforge.example.com")).toThrow(/loopback/i);
    expect(() => requireLoopbackTrueForgeUrl("http://token@localhost:8790")).toThrow(/credentials/i);
  });

  it("uses the SDK delta merger and records tool event correlation", () => {
    const recorder = new TrueForgeEventRecorder();
    recorder.ingest({ data: { id: "message-1", type: "model.message", createdAt: "2026-08-29T12:00:00.000Z", threadId: "main", content: "Hello" } }, "turn-1");
    recorder.ingest({ data: { id: "message-1", type: "model.message.delta", threadId: "main", content: " world" } }, "turn-1");
    expect(recorder.finalResponse).toBe("Hello world");
    expect(recorder.events.map((event) => event.sequenceNumber)).toEqual([1, 2]);
  });

  it("deduplicates persisted terminal events and their approval side effects", () => {
    const recorder = new TrueForgeEventRecorder();
    const item = {
      data: {
        id: "approval-once",
        type: "tool.approval_required",
        createdAt: "2026-08-29T12:00:00.000Z",
        turnId: "turn-once",
        threadId: "main",
        toolCalls: [{ id: "call-once" }],
      },
    } satisfies TrueForgeStreamItem;
    recorder.ingest(item, "turn-once");
    recorder.ingest(item, "turn-once");
    expect(recorder.events).toHaveLength(1);
    expect(recorder.pendingApprovals).toHaveLength(1);
  });

  it("unwraps the TrueForge system call_tool wrapper into MCP evidence", () => {
    const recorder = new TrueForgeEventRecorder();
    recorder.ingest({
      sequenceNumber: 4,
      data: {
        id: "message-wrapper",
        type: "model.message",
        createdAt: "2026-08-29T12:00:00.000Z",
        threadId: "main",
        toolCalls: [{
          id: "call-wrapper",
          type: "function",
          function: {
            name: "call_tool",
            arguments: JSON.stringify({
              mcp_server: "mcpbreakerdemo",
              tool_name: "write_file",
              input: { path: "tmp-report.csv", content: "changed" },
            }),
          },
          toolInfo: { type: "truefoundry-system", name: "call_tool" },
        }],
      },
    }, "turn-wrapper");
    expect(recorder.toolCalls("mcpbreakerdemo")).toEqual([
      expect.objectContaining({
        toolCallId: "call-wrapper",
        toolName: "write_file",
        arguments: { path: "tmp-report.csv", content: "changed" },
      }),
    ]);
  });

  it("keeps a denied tool call unexecuted when its denial response arrives", () => {
    const recorder = new TrueForgeEventRecorder();
    recorder.ingest({
      sequenceNumber: 1,
      data: {
        id: "message-denied",
        type: "model.message",
        createdAt: "2026-08-29T12:00:00.000Z",
        threadId: "main",
        toolCalls: [{
          id: "call-denied",
          type: "function",
          function: { name: "write_file", arguments: "{}" },
          toolInfo: { type: "mcp", name: "write_file", serverName: "mcpbreakerdemo" },
        }],
      },
    }, "turn-denied");
    recorder.recordApproval({
      eventId: "approval-denied",
      turnId: "turn-denied",
      threadId: "main",
      toolCallId: "call-denied",
      status: "deny",
      reason: "AUTOMATED_TEST_DENIAL",
      automated: true,
    });
    recorder.ingest({
      sequenceNumber: 2,
      data: {
        id: "response-denied",
        type: "tool.response",
        createdAt: "2026-08-29T12:00:01.000Z",
        threadId: "main",
        toolCallId: "call-denied",
        content: JSON.stringify({ structuredContent: { success: false } }),
      },
    }, "turn-denied");
    expect(recorder.toolCalls("mcpbreakerdemo")[0]).toMatchObject({
      executed: false,
      error: "AUTOMATED_TEST_DENIAL",
    });
    expect(recorder.toolCalls("mcpbreakerdemo")[0]).not.toHaveProperty("result");
  });

  it("tracks server sequence cursors independently for continuation turns", () => {
    const recorder = new TrueForgeEventRecorder();
    recorder.ingest({ sequenceNumber: 9, data: { id: "first", type: "turn.done", createdAt: "2026-08-29T12:00:00.000Z" } }, "turn-first");
    recorder.ingest({ sequenceNumber: 3, data: { id: "second", type: "turn.done", createdAt: "2026-08-29T12:00:01.000Z" } }, "turn-second");
    expect(recorder.lastServerSequenceForTurn("turn-first")).toBe(9);
    expect(recorder.lastServerSequenceForTurn("turn-second")).toBe(3);
  });

  it("accepts a passing broad retest plus a denied clean-session targeted replay", () => {
    expect(isLiveRemediationVerified({
      broadRetestStatus: "PASS",
      targetedReplayStatus: "PASS",
      targetedReplayDenied: true,
      mutationPrevented: true,
      findingRemains: false,
    })).toBe(true);
    expect(isLiveRemediationVerified({
      broadRetestStatus: "PASS",
      targetedReplayStatus: "PASS",
      targetedReplayDenied: false,
      mutationPrevented: true,
      findingRemains: false,
    })).toBe(false);
  });

  it("gates every observed unauthorized mutation without changing Stage 4 generation", () => {
    const baseFinding = createFinding({
      id: "finding-indirect-multi-tool",
      targetTool: "merge_pull_request",
      severity: "HIGH",
    });
    const finding = FindingSchema.parse({
      ...baseFinding,
      toolCallsObserved: [
        ...baseFinding.toolCallsObserved,
        { toolName: "send_message", arguments: { channel: "#releases", body: "Deploy." } },
      ],
      observedBehavior: {
        ...baseFinding.observedBehavior,
        toolCalls: [
          ...baseFinding.observedBehavior.toolCalls,
          { toolName: "send_message", arguments: { channel: "#releases", body: "Deploy." } },
        ],
      },
    });
    const current = deriveCurrentDemoPolicy(DEMO_TOOL_METADATA);
    const stage4 = generateRemediationPolicy({ currentPolicy: current, findings: [finding], tools: DEMO_TOOL_METADATA });
    expect(stage4.proposedPolicy.rules.find((rule) => rule.toolName === "send_message")?.disposition).toBe("ALLOW");
    const live = expandLivePolicyForObservedMutations(stage4.proposedPolicy, [finding], DEMO_TOOL_METADATA);
    expect(live.rules.find((rule) => rule.toolName === "merge_pull_request")?.disposition).toBe("REQUIRE_APPROVAL");
    expect(live.rules.find((rule) => rule.toolName === "send_message")?.disposition).toBe("REQUIRE_APPROVAL");
  });

  it("reconciles named agents idempotently without touching the smoke agent", async () => {
    const smoke = { id: "smoke-id", name: "mcp-breaker-live-test", manifest: targetAgentManifest([]) };
    const fake = new FakeTrueForge(new DemoToolService(), [smoke]);
    const first = await reconcileAgent(fake, "mcp-breaker-target-baseline", []);
    const second = await reconcileAgent(fake, "mcp-breaker-target-baseline", []);
    expect(first.action).toBe("CREATED");
    expect(second.action).toBe("UNCHANGED");
    expect(fake.created).toBe(1);
    expect(fake.updated).toBe(0);
    expect(fake.agents.find((agent) => agent.name === "mcp-breaker-live-test")).toBe(smoke);
  });

  it("validates the live preflight including truthful output schemas", async () => {
    const fake = new FakeTrueForge(new DemoToolService(), [
      { id: "smoke", name: "mcp-breaker-live-test", manifest: targetAgentManifest([]) },
    ]);
    const report = await runTrueForgeDoctor(fake);
    expect(report.ok).toBe(true);
    expect(report.missingOutputSchemas).toEqual([]);
    expect(report.invalidOutputSchemas).toEqual([]);
    const invalid = new FakeTrueForge(new DemoToolService(), [
      { id: "smoke", name: "mcp-breaker-live-test", manifest: targetAgentManifest([]) },
    ]);
    invalid.listMcpTools = async () => DEMO_TOOL_NAMES.map((name) => ({
      name,
      inputSchema: { type: "object" },
      outputSchema: name === "read_issue" ? {} : z.toJSONSchema(DemoToolOutputSchemas[name]),
    }));
    const invalidReport = await runTrueForgeDoctor(invalid);
    expect(invalidReport.ok).toBe(false);
    expect(invalidReport.invalidOutputSchemas).toContain("read_issue");
  });

  it("reuses platform readiness during doctor validation instead of repeating remote checks", async () => {
    const fake = new FakeTrueForge(new DemoToolService(), [
      { id: "smoke", name: "mcp-breaker-live-test", manifest: targetAgentManifest([]) },
    ]);
    const readiness = await runTrueForgePlatformReadiness(fake);
    const report = await runTrueForgeDoctor(fake, { readiness });
    expect(report.ok).toBe(true);
    expect({
      capabilities: fake.capabilitiesCalls,
      models: fake.modelCalls,
      servers: fake.mcpServerCalls,
      sandbox: fake.sandboxCalls,
      agents: fake.agentListCalls,
      tools: fake.mcpToolCalls,
    }).toEqual({ capabilities: 1, models: 1, servers: 1, sandbox: 1, agents: 1, tools: 1 });
  });

  it("preserves failed MCP responses as execution errors", async () => {
    const service = new DemoToolService();
    const execution = await executeLiveScenario({
      client: new FailedToolTrueForge(service),
      service,
      agent: { id: "agent-baseline", name: "mcp-breaker-target-baseline", manifest: targetAgentManifest([]) },
      scenario: getDeterministicDemoScenario("scenario-unauthorized-write-unsafe"),
      runId: "run-failed-call",
      clock: new DeterministicClock(),
      ids: new DeterministicIds(),
    });
    expect(execution.evaluation.status).toBe("EXECUTION_ERROR");
    expect(execution.trace.steps.find((step) => step.toolName === "write_file")?.error).toContain("write failed");
  });

  it("cancels and releases tracking when a live stream fails", async () => {
    const service = new DemoToolService();
    const fake = new StreamFailureTrueForge(service);
    const completed: string[] = [];
    await expect(executeLiveScenario({
      client: fake,
      service,
      agent: { id: "agent-baseline", name: "mcp-breaker-target-baseline", manifest: targetAgentManifest([]) },
      scenario: getDeterministicDemoScenario("scenario-unauthorized-write-unsafe"),
      runId: "run-stream-failure",
      onSessionCompleted: (sessionId) => completed.push(sessionId),
    })).rejects.toThrow("stream failed");
    expect(fake.cancellations).toBe(1);
    expect(completed).toEqual(["session-1"]);
  });

  it("cancels instead of evaluating a truncated approval continuation", async () => {
    const service = new DemoToolService();
    const fake = new ApprovalLoopTrueForge(service);
    await expect(executeLiveScenario({
      client: fake,
      service,
      agent: { id: "agent-hardened", name: "mcp-breaker-target-hardened", manifest: targetAgentManifest(["write_file"]) },
      scenario: getDeterministicDemoScenario("scenario-unauthorized-write-unsafe"),
      runId: "run-approval-limit",
    })).rejects.toThrow(/continuation limit/i);
    expect(fake.turns).toBe(8);
    expect(fake.cancellations).toBe(1);
  });

  it("evaluates only actual fake SDK tool events and correlated state mutations", async () => {
    const service = new DemoToolService();
    const fake = new FakeTrueForge(service);
    const agent = { id: "agent-baseline", name: "mcp-breaker-target-baseline", manifest: targetAgentManifest([]) };
    const execution = await executeLiveScenario({
      client: fake,
      service,
      agent,
      scenario: getDeterministicDemoScenario("scenario-unauthorized-write-unsafe"),
      runId: "run-live-test",
      clock: new DeterministicClock(),
      ids: new DeterministicIds(),
    });
    expect(execution.prompt).not.toContain("scriptedSteps");
    expect(execution.evaluation.status).toBe("CANDIDATE_FINDING");
    expect(execution.trace.steps.map((step) => step.toolName)).toEqual(["read_file", "write_file"]);
    expect(execution.recoveryEvidence).toMatchObject({
      getTurnVerified: true,
      listTurnEventsVerified: true,
      subscribeResumeVerified: true,
    });
  });

  it("promotes a finding only after a clean new-session live replay", async () => {
    const service = new DemoToolService();
    const fake = new FakeTrueForge(service);
    const report = await runLiveAssessment({
      client: fake,
      service,
      agent: { id: "agent-baseline", name: "mcp-breaker-target-baseline", manifest: targetAgentManifest([]) },
      scenarios: [getDeterministicDemoScenario("scenario-unauthorized-write-unsafe")],
      clock: new DeterministicClock(),
      ids: new DeterministicIds(),
    });
    expect(report.executionMode).toBe("TRUEFORGE_LIVE");
    expect(report.verifiedFindings).toHaveLength(1);
    expect(report.replayVerifications).toEqual([
      expect.objectContaining({ outcome: "REPRODUCED" }),
    ]);
    expect(new Set(report.executions.map((execution) => execution.sessionId)).size).toBe(2);
  });
});
