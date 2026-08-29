import { randomUUID } from "node:crypto";

import {
  ExecutionStepSchema,
  ExecutionTraceSchema,
  type EvidenceProvenance,
  type ExecutionStep,
  type ExecutionTrace,
} from "@mcp-breaker/shared";

export interface Clock {
  now(): string;
}

export interface IdGenerator {
  next(prefix: string): string;
}

export const systemClock: Clock = {
  now: () => new Date().toISOString(),
};

export const randomIdGenerator: IdGenerator = {
  next: (prefix) => `${prefix}-${randomUUID()}`,
};

const sensitiveKeyPattern = /(api[-_]?key|authorization|cookie|password|secret|token)/i;
const sensitiveValuePatterns = [
  /Bearer\s+\S+/gi,
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{12,}\b/g,
  /\bAKIA[A-Z0-9]{12,}\b/g,
  /\b(?:api[-_]?key|cookie|password|secret|token)\s*[:=]\s*\S+/gi,
];

interface SanitizedValue {
  value: ReturnType<typeof sanitizeUnknown>;
  redacted: boolean;
}

interface SanitizationState {
  redacted: boolean;
  seen: WeakSet<object>;
}

function sanitizeUnknown(value: unknown, key: string | undefined, state: SanitizationState): unknown {
  if (key !== undefined && sensitiveKeyPattern.test(key)) {
    state.redacted = true;
    return "[REDACTED]";
  }

  if (typeof value === "string") {
    let sanitized = value;
    for (const pattern of sensitiveValuePatterns) {
      const next = sanitized.replace(pattern, "[REDACTED]");
      if (next !== sanitized) {
        state.redacted = true;
        sanitized = next;
      }
    }
    return sanitized;
  }

  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    if (state.seen.has(value)) {
      return "[CIRCULAR]";
    }
    state.seen.add(value);
    const sanitized = value.map((entry) => sanitizeUnknown(entry, undefined, state));
    state.seen.delete(value);
    return sanitized;
  }

  if (typeof value === "object") {
    if (state.seen.has(value)) {
      return "[CIRCULAR]";
    }
    state.seen.add(value);
    const sanitized = Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeUnknown(entryValue, entryKey, state),
      ]),
    );
    state.seen.delete(value);
    return sanitized;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "symbol") {
    return value.description ?? "[SYMBOL]";
  }
  if (typeof value === "function") {
    return "[FUNCTION]";
  }
  return "[UNDEFINED]";
}

export function sanitizeForTrace(value: unknown): SanitizedValue {
  const state: SanitizationState = { redacted: false, seen: new WeakSet<object>() };
  return {
    value: sanitizeUnknown(value, undefined, state),
    redacted: state.redacted,
  };
}

interface BeginTraceInput {
  traceId?: string;
  sessionId: string;
  testId: string;
  provenance: EvidenceProvenance;
  runId?: string;
  scenarioId?: string;
  executionId?: string;
  replayOfExecutionId?: string;
}

interface RecordStepInput {
  traceId: string;
  toolName: string;
  arguments: unknown;
  stateBefore?: unknown;
  result?: unknown;
  error?: string;
  stateAfter?: unknown;
}

export class TraceRecorder {
  readonly #clock: Clock;
  readonly #idGenerator: IdGenerator;
  readonly #traces = new Map<string, ExecutionTrace>();

  constructor(clock: Clock = systemClock, idGenerator: IdGenerator = randomIdGenerator) {
    this.#clock = clock;
    this.#idGenerator = idGenerator;
  }

  beginTrace(input: BeginTraceInput): ExecutionTrace {
    const trace = ExecutionTraceSchema.parse({
      id: input.traceId ?? this.#idGenerator.next("trace"),
      sessionId: input.sessionId,
      testId: input.testId,
      ...(input.runId === undefined ? {} : { runId: input.runId }),
      ...(input.scenarioId === undefined ? {} : { scenarioId: input.scenarioId }),
      ...(input.executionId === undefined ? {} : { executionId: input.executionId }),
      ...(input.replayOfExecutionId === undefined ? {} : { replayOfExecutionId: input.replayOfExecutionId }),
      provenance: input.provenance,
      startedAt: this.#clock.now(),
      steps: [],
    });

    if (this.#traces.has(trace.id)) {
      throw new Error(`Trace ${trace.id} already exists.`);
    }
    this.#traces.set(trace.id, trace);
    return structuredClone(trace);
  }

  recordStep(input: RecordStepInput): ExecutionStep {
    const trace = this.#traces.get(input.traceId);
    if (trace === undefined) {
      throw new Error(`Trace ${input.traceId} does not exist.`);
    }
    if (trace.completedAt !== undefined) {
      throw new Error(`Trace ${input.traceId} is already complete.`);
    }

    const sanitizedArguments = sanitizeForTrace(input.arguments);
    const sanitizedBefore = input.stateBefore === undefined ? undefined : sanitizeForTrace(input.stateBefore);
    const sanitizedResult = input.result === undefined ? undefined : sanitizeForTrace(input.result);
    const sanitizedAfter = input.stateAfter === undefined ? undefined : sanitizeForTrace(input.stateAfter);
    const sanitizedError = input.error === undefined ? undefined : sanitizeForTrace(input.error);
    const sanitizedErrorValue = sanitizedError?.value;
    if (sanitizedErrorValue !== undefined && typeof sanitizedErrorValue !== "string") {
      throw new Error("Sanitized trace errors must remain strings.");
    }
    const redacted = [sanitizedArguments, sanitizedBefore, sanitizedResult, sanitizedAfter, sanitizedError].some(
      (entry) => entry?.redacted === true,
    );

    const step = ExecutionStepSchema.parse({
      id: this.#idGenerator.next("step"),
      sequence: trace.steps.length,
      timestamp: this.#clock.now(),
      sessionId: trace.sessionId,
      testId: trace.testId,
      ...(trace.runId === undefined ? {} : { runId: trace.runId }),
      ...(trace.scenarioId === undefined ? {} : { scenarioId: trace.scenarioId }),
      ...(trace.executionId === undefined ? {} : { executionId: trace.executionId }),
      toolName: input.toolName,
      arguments: sanitizedArguments.value,
      ...(sanitizedBefore === undefined ? {} : { stateBefore: sanitizedBefore.value }),
      ...(sanitizedResult === undefined ? {} : { result: sanitizedResult.value }),
      ...(sanitizedErrorValue === undefined ? {} : { error: sanitizedErrorValue }),
      ...(sanitizedAfter === undefined ? {} : { stateAfter: sanitizedAfter.value }),
      sensitiveDataRedacted: redacted,
    });

    trace.steps.push(step);
    return structuredClone(step);
  }

  completeTrace(traceId: string): ExecutionTrace {
    const trace = this.#traces.get(traceId);
    if (trace === undefined) {
      throw new Error(`Trace ${traceId} does not exist.`);
    }
    if (trace.completedAt === undefined) {
      trace.completedAt = this.#clock.now();
    }
    return ExecutionTraceSchema.parse(structuredClone(trace));
  }

  getTrace(traceId: string): ExecutionTrace {
    const trace = this.#traces.get(traceId);
    if (trace === undefined) {
      throw new Error(`Trace ${traceId} does not exist.`);
    }
    return ExecutionTraceSchema.parse(structuredClone(trace));
  }

  listTraces(): ExecutionTrace[] {
    return [...this.#traces.values()].map((trace) => ExecutionTraceSchema.parse(structuredClone(trace)));
  }
}
