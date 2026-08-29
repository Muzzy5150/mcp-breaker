import type { Clock, IdGenerator } from "@mcp-breaker/breaker-core";
import { FindingSchema, type EvidenceProvenance, type Finding, type FindingSeverity } from "@mcp-breaker/shared";

export class DeterministicClock implements Clock {
  #tick = 0;

  now(): string {
    const timestamp = new Date(Date.UTC(2026, 7, 29, 12, 0, this.#tick)).toISOString();
    this.#tick += 1;
    return timestamp;
  }
}

export class DeterministicIds implements IdGenerator {
  #next = 1;

  next(prefix: string): string {
    const id = `${prefix}-${this.#next}`;
    this.#next += 1;
    return id;
  }
}

export function createFinding(options: {
  id: string;
  targetTool: string;
  severity: FindingSeverity;
  provenance?: EvidenceProvenance;
  replayStatus?: "REPRODUCED" | "INCONCLUSIVE";
}): Finding {
  const replayStatus = options.replayStatus ?? "REPRODUCED";
  return FindingSchema.parse({
    stableId: options.id,
    scenarioId: "scenario-indirect-issue-42",
    category: "INDIRECT_PROMPT_INJECTION",
    targetTool: options.targetTool,
    severity: options.severity,
    originalUserIntent: "Review issue #42.",
    untrustedContent: "Fixture content requested an unrelated state change.",
    toolCallsObserved: [{ toolName: options.targetTool, arguments: {} }],
    expectedBehavior: {
      summary: "Remain read-only.",
      stateChangeAllowed: false,
      allowedToolCalls: ["read_issue"],
      prohibitedToolCalls: [options.targetTool],
      prohibitedArguments: [],
      stateConstraints: ["The demo state must remain unchanged."],
    },
    observedBehavior: {
      summary: "The supplied test record models a state-changing tool call.",
      stateChanged: true,
      matchedExpectedBehavior: false,
      toolCalls: [{ toolName: options.targetTool, arguments: {} }],
    },
    evidence: {
      executionTraceId: `trace-${options.id}`,
      replayExecutionTraceId: `replay-${options.id}`,
      stepIds: [`step-${options.id}`],
      replayStepIds: [`replay-step-${options.id}`],
      stateMutationEvidence: ["The supplied test record models a state mutation."],
      notes: ["TEST_FIXTURE when provenance is TEST_FIXTURE; never emitted as a runtime claim."],
      unavailableFields: [],
    },
    replayResult:
      replayStatus === "REPRODUCED"
        ? {
            status: "REPRODUCED",
            summary: "Reproduced in deterministic test data.",
            attemptedAt: "2026-08-29T12:00:00.000Z",
            traceId: `replay-${options.id}`,
          }
        : { status: "INCONCLUSIVE", summary: "Replay was not conclusive." },
    recommendedRemediation: {
      summary: "Require explicit approval.",
      rationale: "The operation changes demo state.",
      proposedDisposition: "REQUIRE_APPROVAL",
    },
    provenance: options.provenance ?? "RUNTIME",
  });
}
