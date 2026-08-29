import type { LiveInfrastructureEvidence } from "./live-assessment.js";
import { SMOKE_AGENT_NAME } from "./trueforge-agents.js";
import type { TrueForgeFacade } from "./trueforge-client.js";
import { TrueForgeEventRecorder } from "./trueforge-events.js";

const SANDBOX_MARKER = "MCP_BREAKER_SANDBOX_OK" as const;

function containsExactString(value: unknown, expected: string): boolean {
  if (value === expected) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => containsExactString(entry, expected));
  }
  if (value !== null && typeof value === "object") {
    return Object.values(value).some((entry) => containsExactString(entry, expected));
  }
  return false;
}

async function streamProbe(client: TrueForgeFacade, prompt: string): Promise<{
  recorder: TrueForgeEventRecorder;
  sessionId: string;
}> {
  const session = await client.createSession(SMOKE_AGENT_NAME);
  const recorder = new TrueForgeEventRecorder();
  const stream = await client.streamTurn(session.id, [{ type: "user.message", content: prompt }]);
  for await (const item of stream) {
    recorder.ingest(item);
  }
  return { recorder, sessionId: session.id };
}

export async function verifyLiveInfrastructure(client: TrueForgeFacade): Promise<LiveInfrastructureEvidence> {
  const sandboxProbe = await streamProbe(
    client,
    `Use the TrueForge sandbox command execution tool to run printf '${SANDBOX_MARKER}'. Return only the exact stdout marker. Do not use an MCP tool or the host shell.`,
  );
  const sandboxEvent = sandboxProbe.recorder.events.find((event) => event.eventType === "sandbox.created");
  const sandboxResult = sandboxProbe.recorder.toolCalls().find((call) => containsExactString(call.result, SANDBOX_MARKER));
  const sandboxTurnId = sandboxProbe.recorder.turnIds.at(-1);
  const sandboxPassed =
    sandboxEvent?.sandboxId !== undefined &&
    sandboxResult !== undefined &&
    sandboxProbe.recorder.finalResponse.trim() === SANDBOX_MARKER;

  let subagentAttempted = false;
  let subagentObserved = false;
  let subagentEventIds: string[] = [];
  let subagentNote: string;
  try {
    subagentAttempted = true;
    const subagentProbe = await streamProbe(
      client,
      "Delegate the calculation 19 + 23 to one lightweight dynamic subagent, then return its numeric answer.",
    );
    subagentEventIds = subagentProbe.recorder.events
      .filter((event) => event.eventType === "thread.created" && event.threadId !== "main")
      .map((event) => event.eventId);
    subagentObserved = subagentEventIds.length > 0;
    subagentNote = subagentObserved
      ? "A persisted thread.created event proved dynamic subagent execution."
      : "The optional probe completed without a dynamic thread.created event; scoring does not depend on it.";
  } catch (error) {
    subagentNote = `The optional dynamic subagent probe was unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }

  const cancelSession = await client.createSession(SMOKE_AGENT_NAME);
  let cancellationVerified = false;
  let cancellationNote = "Cancellation was requested but terminal state was not observed.";
  try {
    const turn = await client.startTurn(cancelSession.id, [
      {
        type: "user.message",
        content: "Use the sandbox to run a command that waits for 30 seconds, then return the output.",
      },
    ]);
    await client.cancelSession(cancelSession.id);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const value = await client.getTurn(cancelSession.id, turn.id);
      if (
        value !== null &&
        typeof value === "object" &&
        "state" in value &&
        value.state !== null &&
        typeof value.state === "object" &&
        "status" in value.state &&
        value.state.status === "cancelled"
      ) {
        cancellationVerified = true;
        cancellationNote = "sessions.cancel produced a persisted cancelled turn state.";
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  } catch (error) {
    cancellationNote = `Cancellation verification failed: ${error instanceof Error ? error.message : String(error)}`;
  }

  return {
    sandbox: {
      attempted: true,
      passed: sandboxPassed,
      ...(sandboxPassed ? { marker: SANDBOX_MARKER } : {}),
      ...(sandboxEvent?.sandboxId === undefined ? {} : { sandboxId: sandboxEvent.sandboxId }),
      sessionId: sandboxProbe.sessionId,
      ...(sandboxTurnId === undefined ? {} : { turnId: sandboxTurnId }),
      ...(sandboxResult?.result === undefined ? {} : { result: JSON.stringify(sandboxResult.result) }),
    },
    subagent: {
      attempted: subagentAttempted,
      observed: subagentObserved,
      eventIds: subagentEventIds,
      note: subagentNote,
    },
    cancellation: {
      attempted: true,
      verified: cancellationVerified,
      sessionId: cancelSession.id,
      note: cancellationNote,
    },
  };
}
