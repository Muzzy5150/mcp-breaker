import { randomIdGenerator, systemClock, type Clock, type IdGenerator } from "@mcp-breaker/breaker-core";
import {
  AttackScenarioSchema,
  ScenarioExecutionSchema,
  type AttackScenario,
  type ScenarioExecution,
  type ScenarioExecutionFailure,
} from "@mcp-breaker/shared";

import { DeterministicExecutionAdapter, type ExecutionAdapter } from "./adapter.js";
import { evaluateObservedBehavior } from "./evaluator.js";

export interface RunScenarioOptions {
  runId?: string;
  replayOfExecutionId?: string;
}

type LifecyclePhase = ScenarioExecutionFailure["phase"];

export class ScenarioLifecycleError extends Error {
  readonly failure: ScenarioExecutionFailure;

  constructor(failure: ScenarioExecutionFailure) {
    super(failure.summary);
    this.name = "ScenarioLifecycleError";
    this.failure = failure;
  }
}

export class ScenarioRunner {
  readonly #adapter: ExecutionAdapter;
  readonly #clock: Clock;
  readonly #ids: IdGenerator;

  constructor(adapter: ExecutionAdapter, clock: Clock = systemClock, ids: IdGenerator = randomIdGenerator) {
    this.#adapter = adapter;
    this.#clock = clock;
    this.#ids = ids;
  }

  async runScenario(rawScenario: AttackScenario, options: RunScenarioOptions = {}): Promise<ScenarioExecution> {
    const scenario = AttackScenarioSchema.parse(rawScenario);
    const runId = options.runId ?? this.#ids.next("run");
    const executionId = this.#ids.next("execution");
    const traceId = this.#ids.next("trace");
    const startedAt = this.#clock.now();
    const runLifecycle = async <Value>(phase: LifecyclePhase, operation: () => Promise<Value>): Promise<Value> => {
      try {
        return await operation();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new ScenarioLifecycleError({
          runId,
          scenarioId: scenario.id,
          executionId,
          traceId,
          ...(options.replayOfExecutionId === undefined
            ? {}
            : { replayOfExecutionId: options.replayOfExecutionId }),
          phase,
          startedAt,
          failedAt: this.#clock.now(),
          summary: `${phase} failed: ${message}`,
        });
      }
    };
    const resetState = await runLifecycle("RESET", () => this.#adapter.reset());
    const resetEvent = {
      timestamp: this.#clock.now(),
      reason: options.replayOfExecutionId === undefined ? "INITIAL_EXECUTION" : "REPLAY_VERIFICATION",
      state: resetState,
    } as const;
    const baselineCapturedAt = this.#clock.now();
    const baselineState = await runLifecycle("BASELINE_SNAPSHOT", () => this.#adapter.snapshot());

    await runLifecycle("BEGIN_EXECUTION", () =>
      this.#adapter.beginExecution({
        runId,
        scenarioId: scenario.id,
        executionId,
        traceId,
        ...(options.replayOfExecutionId === undefined
          ? {}
          : { replayOfExecutionId: options.replayOfExecutionId }),
      }),
    );

    let executionError: string | undefined;
    for (const step of scenario.scriptedSteps) {
      try {
        await this.#adapter.executeStep(step, traceId);
      } catch (error) {
        executionError = error instanceof Error ? error.message : String(error);
        break;
      }
    }

    const trace = await runLifecycle("COMPLETE_EXECUTION", () => this.#adapter.completeExecution(traceId));
    const finalState = await runLifecycle("FINAL_SNAPSHOT", () => this.#adapter.snapshot());
    const { evaluation, observedBehavior } = evaluateObservedBehavior({
      scenario,
      trace,
      baselineState,
      finalState,
      ...(executionError === undefined ? {} : { executionError }),
    });

    return ScenarioExecutionSchema.parse({
      runId,
      scenarioId: scenario.id,
      executionId,
      traceId,
      ...(options.replayOfExecutionId === undefined
        ? {}
        : { replayOfExecutionId: options.replayOfExecutionId }),
      startedAt,
      completedAt: this.#clock.now(),
      resetEvent,
      baselineCapturedAt,
      baselineState,
      finalState,
      finalResponse: scenario.deterministicFinalResponse,
      trace,
      observedBehavior,
      evaluation,
    });
  }
}

export interface RunScenarioDependencies {
  adapter?: ExecutionAdapter;
  clock?: Clock;
  ids?: IdGenerator;
  options?: RunScenarioOptions;
}

export async function runScenario(
  scenario: AttackScenario,
  dependencies: RunScenarioDependencies = {},
): Promise<ScenarioExecution> {
  return new ScenarioRunner(
    dependencies.adapter ?? new DeterministicExecutionAdapter(),
    dependencies.clock,
    dependencies.ids,
  ).runScenario(scenario, dependencies.options);
}
