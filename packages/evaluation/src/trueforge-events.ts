import { isEventDelta, mergeEventDelta, type TrueForgeApi } from "@truefoundry/trueforge-sdk";
import {
  LiveApprovalEvidenceSchema,
  LiveToolCallEvidenceSchema,
  TrueForgeEventEvidenceSchema,
  type LiveApprovalEvidence,
  type LiveToolCallEvidence,
  type TrueForgeEventEvidence,
} from "@mcp-breaker/shared";

import type { TrueForgeStreamItem } from "./trueforge-client.js";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isTextBlock(value: unknown): value is UnknownRecord & { type: "text"; text: string } {
  return isRecord(value) && value.type === "text" && typeof value.text === "string";
}

function stringField(value: UnknownRecord, field: string): string | undefined {
  const candidate = value[field];
  return typeof candidate === "string" ? candidate : undefined;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function unwrapToolResult(content: string): { result?: unknown; error?: string } {
  const parsed = parseJson(content);
  if (!isRecord(parsed)) {
    return { result: parsed };
  }
  if (parsed.isError === true) {
    return { error: content };
  }
  if (parsed.structuredContent !== undefined) {
    return { result: parsed.structuredContent };
  }
  const blocks = parsed.content;
  if (Array.isArray(blocks)) {
    const textBlock = (blocks as unknown[]).find(isTextBlock);
    if (textBlock !== undefined) {
      return { result: parseJson(textBlock.text) };
    }
  }
  return { result: parsed };
}

function contentText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return (content as unknown[])
    .filter(isTextBlock)
    .map((part) => part.text)
    .join("");
}

export interface PendingApproval {
  eventId: string;
  turnId: string;
  threadId: string;
  toolCallIds: string[];
}

interface MutableToolCall {
  toolCallId: string;
  sourceEventId: string;
  responseEventId?: string;
  threadId: string;
  toolName: string;
  serverName: string;
  arguments: unknown;
  result?: unknown;
  error?: string;
  executed: boolean;
}

export class TrueForgeEventRecorder {
  readonly #events: TrueForgeEventEvidence[] = [];
  readonly #toolCalls = new Map<string, MutableToolCall>();
  readonly #messages = new Map<string, TrueForgeApi.ModelMessageEvent>();
  readonly #seenTerminalEventIds = new Set<string>();
  readonly #approvals: LiveApprovalEvidence[] = [];
  readonly #deniedToolCallIds = new Set<string>();
  readonly #pendingApprovals: PendingApproval[] = [];
  readonly #turnIds: string[] = [];
  #lastSequenceNumber = 0;
  #lastServerSequenceNumber = 0;
  readonly #lastServerSequenceByTurn = new Map<string, number>();

  get events(): readonly TrueForgeEventEvidence[] {
    return this.#events;
  }

  get approvals(): readonly LiveApprovalEvidence[] {
    return this.#approvals;
  }

  get pendingApprovals(): readonly PendingApproval[] {
    return this.#pendingApprovals;
  }

  get turnIds(): readonly string[] {
    return this.#turnIds;
  }

  get lastSequenceNumber(): number {
    return this.#lastSequenceNumber;
  }

  get lastServerSequenceNumber(): number {
    return this.#lastServerSequenceNumber;
  }

  lastServerSequenceForTurn(turnId: string): number {
    return this.#lastServerSequenceByTurn.get(turnId) ?? 0;
  }

  get finalResponse(): string {
    return [...this.#messages.values()].map((message) => contentText(message.content)).filter(Boolean).at(-1) ?? "";
  }

  toolCalls(serverName?: string): LiveToolCallEvidence[] {
    return [...this.#toolCalls.values()]
      .filter((call) => serverName === undefined || call.serverName === serverName)
      .map((call) => LiveToolCallEvidenceSchema.parse(call));
  }

  recordApproval(input: LiveApprovalEvidence): void {
    this.#approvals.push(LiveApprovalEvidenceSchema.parse(input));
    if (input.status === "deny") {
      this.#deniedToolCallIds.add(input.toolCallId);
      const call = this.#toolCalls.get(input.toolCallId);
      if (call !== undefined) {
        call.executed = false;
        call.error = input.reason ?? "Tool call denied.";
        delete call.result;
      }
    }
  }

  clearPendingApprovals(): void {
    this.#pendingApprovals.length = 0;
  }

  #captureToolCalls(event: UnknownRecord): void {
    if (!Array.isArray(event.toolCalls)) {
      return;
    }
    for (const rawCall of event.toolCalls as unknown[]) {
      if (!isRecord(rawCall) || typeof rawCall.id !== "string" || !isRecord(rawCall.function)) {
        continue;
      }
      const toolInfo = isRecord(rawCall.toolInfo) ? rawCall.toolInfo : undefined;
      let toolName = toolInfo === undefined ? undefined : stringField(toolInfo, "name");
      let serverName = toolInfo === undefined
        ? undefined
        : stringField(toolInfo, "serverName") ?? (toolInfo.type === "truefoundry-system" ? "truefoundry-system" : undefined);
      if (toolName === undefined || serverName === undefined) {
        continue;
      }
      const argumentsText = stringField(rawCall.function, "arguments") ?? "{}";
      let toolArguments = parseJson(argumentsText);
      if (toolInfo?.type === "truefoundry-system" && toolName === "call_tool" && isRecord(toolArguments)) {
        const mcpServer = stringField(toolArguments, "mcp_server");
        const mcpTool = stringField(toolArguments, "tool_name");
        if (mcpServer !== undefined && mcpTool !== undefined && toolArguments.input !== undefined) {
          serverName = mcpServer;
          toolName = mcpTool;
          toolArguments = toolArguments.input;
        }
      }
      const existing = this.#toolCalls.get(rawCall.id);
      this.#toolCalls.set(rawCall.id, {
        toolCallId: rawCall.id,
        sourceEventId: stringField(event, "id") ?? existing?.sourceEventId ?? rawCall.id,
        ...(existing?.responseEventId === undefined ? {} : { responseEventId: existing.responseEventId }),
        threadId: stringField(event, "threadId") ?? existing?.threadId ?? "main",
        toolName,
        serverName,
        arguments: toolArguments,
        ...(existing?.result === undefined ? {} : { result: existing.result }),
        ...(existing?.error === undefined ? {} : { error: existing.error }),
        executed: existing?.executed ?? false,
      });
    }
  }

  ingest(item: TrueForgeStreamItem, fallbackTurnId?: string): void {
    if (!isRecord(item.data)) {
      return;
    }
    const event = item.data;
    const type = stringField(event, "type");
    const eventId = stringField(event, "id");
    if (type === undefined || eventId === undefined) {
      return;
    }
    if (type !== "model.message.delta") {
      if (this.#seenTerminalEventIds.has(eventId)) {
        return;
      }
      this.#seenTerminalEventIds.add(eventId);
    }
    const eventTurnId = stringField(event, "turnId") ?? fallbackTurnId ?? this.#turnIds.at(-1);
    if (type === "turn.created") {
      const createdTurnId = stringField(event, "turnId");
      if (createdTurnId !== undefined && !this.#turnIds.includes(createdTurnId)) {
        this.#turnIds.push(createdTurnId);
      }
    }
    const sequenceNumber = item.sequenceNumber ?? this.#lastSequenceNumber + 1;
    this.#lastSequenceNumber = Math.max(this.#lastSequenceNumber, sequenceNumber);
    if (item.sequenceNumber !== undefined) {
      this.#lastServerSequenceNumber = Math.max(this.#lastServerSequenceNumber, item.sequenceNumber);
      if (eventTurnId !== undefined) {
        this.#lastServerSequenceByTurn.set(
          eventTurnId,
          Math.max(this.#lastServerSequenceByTurn.get(eventTurnId) ?? 0, item.sequenceNumber),
        );
      }
    }
    this.#events.push(
      TrueForgeEventEvidenceSchema.parse({
        sequenceNumber,
        ...(eventTurnId === undefined ? {} : { turnId: eventTurnId }),
        eventId,
        eventType: type,
        recordedAt: stringField(event, "createdAt") ?? new Date().toISOString(),
        ...(event.threadId === undefined ? {} : { threadId: event.threadId }),
        ...(stringField(event, "toolCallId") === undefined ? {} : { toolCallId: stringField(event, "toolCallId") }),
        ...(stringField(event, "sandboxId") === undefined ? {} : { sandboxId: stringField(event, "sandboxId") }),
      }),
    );

    if (type === "model.message.delta") {
      const base = this.#messages.get(eventId);
      const delta = event as unknown as TrueForgeApi.ModelMessageDeltaEvent;
      if (base !== undefined && isEventDelta(delta)) {
        mergeEventDelta(base, delta);
        this.#captureToolCalls(base as unknown as UnknownRecord);
      }
      return;
    }
    if (type === "model.message") {
      const message = event as unknown as TrueForgeApi.ModelMessageEvent;
      this.#messages.set(eventId, message);
      this.#captureToolCalls(event);
      return;
    }
    if (type === "tool.response") {
      const toolCallId = stringField(event, "toolCallId");
      const content = stringField(event, "content");
      const call = toolCallId === undefined ? undefined : this.#toolCalls.get(toolCallId);
      if (call !== undefined && content !== undefined) {
        call.responseEventId = eventId;
        if (this.#deniedToolCallIds.has(call.toolCallId)) {
          call.executed = false;
          call.error ??= "Tool call denied.";
          delete call.result;
          return;
        }
        const result = unwrapToolResult(content);
        call.executed = result.error === undefined;
        if (result.error === undefined) {
          call.result = result.result;
        } else {
          call.error = result.error;
        }
      }
      return;
    }
    if (type === "tool.approval_required" && eventTurnId !== undefined && Array.isArray(event.toolCalls)) {
      const toolCallIds = event.toolCalls
        .filter(isRecord)
        .map((reference) => stringField(reference, "id"))
        .filter((value): value is string => value !== undefined);
      this.#pendingApprovals.push({
        eventId,
        turnId: eventTurnId,
        threadId: stringField(event, "threadId") ?? "main",
        toolCallIds,
      });
    }
  }
}
