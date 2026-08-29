import { TraceRecorder, sanitizeForTrace } from "@mcp-breaker/breaker-core";
import { DemoStateStore, DemoToolService } from "@mcp-breaker/demo-target";
import { describe, expect, it } from "vitest";

import { DeterministicClock, DeterministicIds } from "./helpers.js";

describe("execution trace recorder", () => {
  it("records deterministic before/result/after evidence for a mutation", async () => {
    const clock = new DeterministicClock();
    const recorder = new TraceRecorder(clock, new DeterministicIds());
    const service = new DemoToolService(new DemoStateStore(() => clock.now()), recorder);

    const call = await service.invokeStandalone(
      "write_file",
      { path: "evidence.txt", content: "recorded" },
      { sessionId: "session-1", testId: "test-1", provenance: "TEST_FIXTURE" },
    );

    expect(call.trace.id).toBe("trace-1");
    expect(call.trace.steps).toHaveLength(1);
    expect(call.trace.steps[0]).toMatchObject({
      id: "step-2",
      sequence: 0,
      toolName: "write_file",
      sessionId: "session-1",
      testId: "test-1",
      result: { created: true },
    });
    expect(call.trace.steps[0]?.stateBefore).toBeDefined();
    expect(call.trace.steps[0]?.stateAfter).toBeDefined();
    expect(call.trace.completedAt).toBeDefined();
  });

  it("records rejected calls without changing state", async () => {
    const clock = new DeterministicClock();
    const recorder = new TraceRecorder(clock, new DeterministicIds());
    const service = new DemoToolService(new DemoStateStore(() => clock.now()), recorder);

    await expect(
      service.invokeStandalone(
        "delete_file",
        { path: "missing.txt" },
        { sessionId: "session-2", testId: "test-2", provenance: "TEST_FIXTURE" },
      ),
    ).rejects.toThrow("does not exist");

    const trace = recorder.listTraces()[0];
    expect(trace?.steps[0]?.error).toContain("does not exist");
    expect(trace?.steps[0]?.stateAfter).toEqual(trace?.steps[0]?.stateBefore);
  });

  it("redacts secret-shaped keys and values before recording", () => {
    const sanitized = sanitizeForTrace({
      apiKey: "not-a-real-key",
      nested: { authorization: "Bearer example-token", safe: "visible" },
      value: ["sk", "abcdefghijklmnop"].join("-"),
    });

    expect(sanitized.redacted).toBe(true);
    expect(sanitized.value).toEqual({
      apiKey: "[REDACTED]",
      nested: { authorization: "[REDACTED]", safe: "visible" },
      value: "[REDACTED]",
    });
  });

  it("redacts credentials embedded inside recorded error messages", () => {
    const recorder = new TraceRecorder(new DeterministicClock(), new DeterministicIds());
    const trace = recorder.beginTrace({
      sessionId: "session-error",
      testId: "test-error",
      provenance: "TEST_FIXTURE",
    });
    const credential = ["Bearer", "demo-token-value"].join(" ");

    recorder.recordStep({
      traceId: trace.id,
      toolName: "read_issue",
      arguments: {},
      error: `Request rejected for ${credential}`,
    });

    const recorded = recorder.completeTrace(trace.id);
    expect(recorded.steps[0]?.error).toBe("Request rejected for [REDACTED]");
    expect(recorded.steps[0]?.sensitiveDataRedacted).toBe(true);
  });
});
