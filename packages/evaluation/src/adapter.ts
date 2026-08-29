import { DemoToolService, DEMO_TOOL_NAMES, type DemoToolName, type DemoState } from "@mcp-breaker/demo-target";
import type { ExecutionTrace, ScriptedToolStep } from "@mcp-breaker/shared";

export interface ExecutionCorrelation {
  runId: string;
  scenarioId: string;
  executionId: string;
  traceId: string;
  replayOfExecutionId?: string;
}

export interface ExecutionAdapter<State = unknown> {
  readonly executionMode: "DETERMINISTIC_TEST";
  reset(): Promise<State>;
  snapshot(): Promise<State>;
  beginExecution(correlation: ExecutionCorrelation): Promise<ExecutionTrace>;
  executeStep(step: ScriptedToolStep, traceId: string): Promise<unknown>;
  completeExecution(traceId: string): Promise<ExecutionTrace>;
}

function isDemoToolName(value: string): value is DemoToolName {
  return (DEMO_TOOL_NAMES as readonly string[]).includes(value);
}

export class DeterministicExecutionAdapter implements ExecutionAdapter<DemoState> {
  readonly executionMode = "DETERMINISTIC_TEST" as const;
  readonly service: DemoToolService;

  constructor(service = new DemoToolService()) {
    this.service = service;
  }

  async reset(): Promise<DemoState> {
    await Promise.resolve();
    return this.service.state.reset();
  }

  async snapshot(): Promise<DemoState> {
    await Promise.resolve();
    return this.service.state.snapshot();
  }

  async beginExecution(correlation: ExecutionCorrelation): Promise<ExecutionTrace> {
    await Promise.resolve();
    return this.service.traces.beginTrace({
      traceId: correlation.traceId,
      sessionId: correlation.runId,
      testId: correlation.scenarioId,
      provenance: "RUNTIME",
      runId: correlation.runId,
      scenarioId: correlation.scenarioId,
      executionId: correlation.executionId,
      ...(correlation.replayOfExecutionId === undefined
        ? {}
        : { replayOfExecutionId: correlation.replayOfExecutionId }),
    });
  }

  async executeStep(step: ScriptedToolStep, traceId: string): Promise<unknown> {
    if (!isDemoToolName(step.toolName)) {
      throw new Error(`The deterministic demo adapter does not expose tool ${step.toolName}.`);
    }
    return this.service.invoke(step.toolName, step.arguments, { traceId });
  }

  async completeExecution(traceId: string): Promise<ExecutionTrace> {
    await Promise.resolve();
    return this.service.traces.completeTrace(traceId);
  }
}
