import {
  SAFE_CONTROL_SCENARIOS,
  UNSAFE_DEMO_SCENARIOS,
  getDeterministicDemoScenario,
} from "@mcp-breaker/attack-library";
import { TraceRecorder } from "@mcp-breaker/breaker-core";
import { DemoStateStore, DemoToolService, createBaselineDemoState } from "@mcp-breaker/demo-target";
import {
  DeterministicExecutionAdapter,
  ScenarioRunner,
  runAssessment,
  type ExecutionCorrelation,
} from "@mcp-breaker/evaluation";
import {
  DeterministicAssessmentReportSchema,
  type ExecutionTrace,
  type ScriptedToolStep,
} from "@mcp-breaker/shared";
import { describe, expect, it, vi } from "vitest";

import { DeterministicClock, DeterministicIds } from "./helpers.js";

function deterministicHarness(): {
  adapter: DeterministicExecutionAdapter;
  clock: DeterministicClock;
  ids: DeterministicIds;
} {
  const clock = new DeterministicClock();
  const ids = new DeterministicIds();
  const store = new DemoStateStore(() => clock.now());
  const traces = new TraceRecorder(clock, ids);
  return { adapter: new DeterministicExecutionAdapter(new DemoToolService(store, traces)), clock, ids };
}

describe("Stage 2 deterministic evaluation", () => {
  it("resets state, captures baseline, preserves tool order, and correlates trace identifiers", async () => {
    const { adapter, clock, ids } = deterministicHarness();
    adapter.service.state.deleteFile("customer-data.csv");
    const runner = new ScenarioRunner(adapter, clock, ids);
    const execution = await runner.runScenario(
      getDeterministicDemoScenario("scenario-unauthorized-write-unsafe"),
      { runId: "assessment-reset-test" },
    );

    expect(execution.resetEvent.state).toEqual(createBaselineDemoState());
    expect(execution.baselineState).toEqual(createBaselineDemoState());
    expect(execution.trace.steps.map((step) => step.toolName)).toEqual(["read_file", "write_file"]);
    expect(execution.trace.steps.map((step) => step.sequence)).toEqual([0, 1]);
    expect(execution.trace).toMatchObject({
      runId: execution.runId,
      scenarioId: execution.scenarioId,
      executionId: execution.executionId,
      id: execution.traceId,
    });
    expect(execution.evaluation.status).toBe("CANDIDATE_FINDING");
  });

  it("returns PASS for every safe control and CANDIDATE_FINDING for every unsafe fixture", async () => {
    const safeHarness = deterministicHarness();
    const safeRunner = new ScenarioRunner(safeHarness.adapter, safeHarness.clock, safeHarness.ids);
    for (const scenario of SAFE_CONTROL_SCENARIOS) {
      expect((await safeRunner.runScenario(scenario)).evaluation.status).toBe("PASS");
    }

    const unsafeHarness = deterministicHarness();
    const unsafeRunner = new ScenarioRunner(unsafeHarness.adapter, unsafeHarness.clock, unsafeHarness.ids);
    for (const scenario of UNSAFE_DEMO_SCENARIOS) {
      expect((await unsafeRunner.runScenario(scenario)).evaluation.status).toBe("CANDIDATE_FINDING");
    }
  });

  it("detects the protected customer-data.csv argument and resulting state violation", async () => {
    const { adapter, clock, ids } = deterministicHarness();
    const execution = await new ScenarioRunner(adapter, clock, ids).runScenario(
      getDeterministicDemoScenario("scenario-destructive-cleanup-unsafe"),
    );
    expect(execution.evaluation.violations.map((violation) => violation.kind)).toEqual([
      "PROHIBITED_ARGUMENT",
      "STATE_CONDITION",
    ]);
    expect(execution.finalState).not.toHaveProperty("files.customer-data.csv");
  });

  it("does not create a candidate from a disallowed read-only call without a state mutation", async () => {
    const { adapter, clock, ids } = deterministicHarness();
    const scenario = getDeterministicDemoScenario("scenario-indirect-issue-42-safe");
    scenario.expectedBehavior.allowedToolCalls = [];
    scenario.expectedBehavior.prohibitedToolCalls = ["read_issue"];
    const execution = await new ScenarioRunner(adapter, clock, ids).runScenario(scenario);
    expect(execution.evaluation.status).toBe("INCONCLUSIVE");
    expect(execution.observedBehavior.stateChanged).toBe(false);
  });

  it("replays candidates with distinct linked traces, promotes only reproduced evidence, and scores it", async () => {
    const { adapter, clock, ids } = deterministicHarness();
    const resetSpy = vi.spyOn(adapter, "reset");
    const report = await runAssessment(undefined, { adapter, clock, ids });

    expect(report.counts).toEqual({
      scenariosExecuted: 8,
      passes: 4,
      candidates: 4,
      reproduced: 4,
      inconclusive: 0,
      errors: 0,
    });
    expect(report.verifiedFindings).toHaveLength(4);
    expect(resetSpy).toHaveBeenCalledTimes(12);
    expect(report.verifiedFindings.every((finding) => finding.provenance === "RUNTIME")).toBe(true);
    expect(report.verifiedFindings.every((finding) => finding.replayResult.status === "REPRODUCED")).toBe(true);
    expect(report.securityAssessment.findingCounts).toEqual({
      INFO: 0,
      LOW: 0,
      MEDIUM: 1,
      HIGH: 2,
      CRITICAL: 1,
    });
    expect(report.securityAssessment.score).toBe(15);
    for (const verification of report.replayVerifications) {
      const original = report.executions.find(
        (execution) => execution.executionId === verification.originalExecutionId,
      );
      expect(verification.replayTraceId).not.toBe(original?.traceId);
      expect(verification.replayExecution?.replayOfExecutionId).toBe(original?.executionId);
    }
    expect(DeterministicAssessmentReportSchema.safeParse(JSON.parse(JSON.stringify(report))).success).toBe(true);
  });

  it("creates no verified Finding and no score deduction when a candidate fails replay", async () => {
    class NonReproducingAdapter extends DeterministicExecutionAdapter {
      #resetCount = 0;

      override async reset() {
        this.#resetCount += 1;
        return super.reset();
      }

      override async executeStep(step: ScriptedToolStep, traceId: string): Promise<unknown> {
        if (this.#resetCount === 2 && step.toolName === "send_message") {
          return { deliberatelyNotReproduced: true };
        }
        return super.executeStep(step, traceId);
      }
    }

    const clock = new DeterministicClock();
    const ids = new DeterministicIds();
    const traces = new TraceRecorder(clock, ids);
    const adapter = new NonReproducingAdapter(
      new DemoToolService(new DemoStateStore(() => clock.now()), traces),
    );
    const report = await runAssessment(
      [getDeterministicDemoScenario("scenario-confused-deputy-unsafe")],
      { adapter, clock, ids },
    );

    expect(report.counts).toMatchObject({ candidates: 1, reproduced: 0 });
    expect(report.replayVerifications).toMatchObject([{ outcome: "NOT_REPRODUCED" }]);
    expect(report.verifiedFindings).toEqual([]);
    expect(report.securityAssessment.score).toBe(100);
    expect(report.securityAssessment.findingIds).toEqual([]);
  });

  it("executes the suite without making external fetch calls", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network forbidden"));
    const { adapter, clock, ids } = deterministicHarness();
    await runAssessment(undefined, { adapter, clock, ids });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("execution adapter contract", () => {
  it("is explicitly deterministic test execution", () => {
    expect(new DeterministicExecutionAdapter().executionMode).toBe("DETERMINISTIC_TEST");
  });

  it("exposes correlation types without implying a model runtime", () => {
    const correlation: ExecutionCorrelation = {
      runId: "run-contract",
      scenarioId: "scenario-contract",
      executionId: "execution-contract",
      traceId: "trace-contract",
    };
    const trace: ExecutionTrace | undefined = undefined;
    expect(correlation.traceId).toBe("trace-contract");
    expect(trace).toBeUndefined();
  });
});
