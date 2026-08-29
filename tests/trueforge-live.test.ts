/* eslint-disable @typescript-eslint/require-await -- async methods intentionally model the SDK facade. */
import { getDeterministicDemoScenario } from "@mcp-breaker/attack-library";
import { deriveCurrentDemoPolicy, generateRemediationPolicy } from "@mcp-breaker/breaker-core";
import { DemoToolService, DEMO_TOOL_METADATA, DEMO_TOOL_NAMES } from "@mcp-breaker/demo-target";
import {
  executeLiveScenario,
  expandLivePolicyForObservedMutations,
  isLiveRemediationVerified,
  reconcileAgent,
  runLiveAssessment,
  runTrueForgeDoctor,
  targetAgentManifest,
  TrueForgeEventRecorder,
  type TrueForgeAgentRecord,
  type TrueForgeFacade,
  type TrueForgeStreamItem,
  type TrueForgeTurnInput,
} from "@mcp-breaker/evaluation";
import { FindingSchema } from "@mcp-breaker/shared";
import { describe, expect, it } from "vitest";

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
  #sessionNumber = 0;

  constructor(service = new DemoToolService(), agents: TrueForgeAgentRecord[] = []) {
    this.service = service;
    this.agents = agents;
  }

  async getCapabilities(): Promise<unknown> {
    return { sandbox: { enabled: true } };
  }

  async listModels(): Promise<readonly { name: string }[]> {
    return [{ name: "openai/gpt-5-6-terra" }];
  }

  async listMcpServers(): Promise<readonly { name: string; url: string; authStatus: unknown }[]> {
    return [{ name: "mcpbreakerdemo", url: "http://127.0.0.1:18880/mcp", authStatus: { status: "not_required" } }];
  }

  async listMcpTools(): Promise<readonly Record<string, unknown>[]> {
    return DEMO_TOOL_NAMES.map((name) => ({ name, inputSchema: { type: "object" }, outputSchema: { type: "object" } }));
  }

  async getSandboxProvider(): Promise<{ type: string; status: string; statusReason: string | null }> {
    return { type: "daytona", status: "ready", statusReason: null };
  }

  async listAgents(): Promise<readonly TrueForgeAgentRecord[]> {
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

describe("TrueForge Stage 5 integration", () => {
  it("uses the SDK delta merger and records tool event correlation", () => {
    const recorder = new TrueForgeEventRecorder();
    recorder.ingest({ data: { id: "message-1", type: "model.message", createdAt: "2026-08-29T12:00:00.000Z", threadId: "main", content: "Hello" } }, "turn-1");
    recorder.ingest({ data: { id: "message-1", type: "model.message.delta", threadId: "main", content: " world" } }, "turn-1");
    expect(recorder.finalResponse).toBe("Hello world");
    expect(recorder.events.map((event) => event.sequenceNumber)).toEqual([1, 2]);
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
