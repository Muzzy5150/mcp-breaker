import { TrueForge, type TrueForgeApi } from "@truefoundry/trueforge-sdk";

import { requireLoopbackTrueForgeUrl } from "./trueforge-safety.js";

export const TRUEFORGE_SDK_VERSION = "0.1.3";

export interface TrueForgeAgentRecord {
  id: string;
  name: string;
  manifest: TrueForgeApi.AgentSpec;
}

export interface TrueForgeStreamItem {
  data: unknown;
  sequenceNumber?: number;
}

export type TrueForgeTurnInput =
  | { type: "user.message"; content: string }
  | {
      type: "user.tool_approval";
      threadId: string;
      toolCallId: string;
      approval: { status: "allow" } | { status: "deny"; reason: string };
    };

export interface TrueForgeFacade {
  getCapabilities(signal?: AbortSignal): Promise<unknown>;
  listModels(signal?: AbortSignal): Promise<readonly { name: string }[]>;
  listMcpServers(signal?: AbortSignal): Promise<readonly { name: string; url: string; authStatus: unknown }[]>;
  listMcpTools(name: string, signal?: AbortSignal): Promise<readonly Record<string, unknown>[]>;
  getSandboxProvider(signal?: AbortSignal): Promise<{ type: string; status: string; statusReason: string | null }>;
  listAgents(signal?: AbortSignal): Promise<readonly TrueForgeAgentRecord[]>;
  createAgent(name: string, manifest: TrueForgeApi.AgentSpec, signal?: AbortSignal): Promise<TrueForgeAgentRecord>;
  updateAgent(id: string, manifest: TrueForgeApi.AgentSpec, signal?: AbortSignal): Promise<TrueForgeAgentRecord>;
  createSession(agentName: string, signal?: AbortSignal): Promise<{ id: string }>;
  streamTurn(
    sessionId: string,
    input: readonly TrueForgeTurnInput[],
    previousTurnId?: string,
    signal?: AbortSignal,
  ): Promise<AsyncIterable<TrueForgeStreamItem>>;
  startTurn(sessionId: string, input: readonly TrueForgeTurnInput[], signal?: AbortSignal): Promise<{ id: string }>;
  getTurn(sessionId: string, turnId: string, signal?: AbortSignal): Promise<unknown>;
  listTurnEvents(sessionId: string, turnId: string, signal?: AbortSignal): Promise<readonly unknown[]>;
  subscribeToTurn(
    sessionId: string,
    turnId: string,
    afterSequenceNumber: number,
    signal?: AbortSignal,
  ): Promise<AsyncIterable<TrueForgeStreamItem>>;
  cancelSession(sessionId: string): Promise<unknown>;
}

function requestOptions(signal?: AbortSignal): { abortSignal: AbortSignal } | undefined {
  return signal === undefined ? undefined : { abortSignal: signal };
}

function streamWithMetadata<Value extends object>(stream: {
  withMetadata(): AsyncIterable<{ data: Value; id?: string }>;
}): AsyncIterable<TrueForgeStreamItem> {
  return {
    async *[Symbol.asyncIterator]() {
      for await (const item of stream.withMetadata()) {
        const parsed = item.id === undefined ? undefined : Number.parseInt(item.id, 10);
        yield {
          data: item.data,
          ...(parsed === undefined || Number.isNaN(parsed) ? {} : { sequenceNumber: parsed }),
        };
      }
    },
  };
}

export class OfficialTrueForgeFacade implements TrueForgeFacade {
  readonly #client: TrueForge;

  constructor(baseUrl: string, token = process.env.TRUEFORGE_TOKEN) {
    this.#client = new TrueForge({
      baseUrl: requireLoopbackTrueForgeUrl(baseUrl),
      ...(token === undefined ? {} : { token }),
      timeoutInSeconds: 600,
    });
  }

  async getCapabilities(signal?: AbortSignal): Promise<unknown> {
    return (await this.#client.server.getCapabilities(requestOptions(signal))).data;
  }

  async listModels(signal?: AbortSignal): Promise<readonly { name: string }[]> {
    return (await this.#client.models.list(requestOptions(signal))).data;
  }

  async listMcpServers(signal?: AbortSignal): Promise<readonly { name: string; url: string; authStatus: unknown }[]> {
    return (await this.#client.mcpServers.list(requestOptions(signal))).data;
  }

  async listMcpTools(name: string, signal?: AbortSignal): Promise<readonly Record<string, unknown>[]> {
    return (await this.#client.mcpServers.listTools(name, requestOptions(signal))).data;
  }

  async getSandboxProvider(signal?: AbortSignal): Promise<{ type: string; status: string; statusReason: string | null }> {
    const response = await this.#client.settings.sandboxProviders.get(requestOptions(signal));
    return {
      type: response.data.manifest.type,
      status: response.data.status,
      statusReason: response.data.statusReason,
    };
  }

  async listAgents(signal?: AbortSignal): Promise<readonly TrueForgeAgentRecord[]> {
    return (await this.#client.agents.list(requestOptions(signal))).data;
  }

  async createAgent(name: string, manifest: TrueForgeApi.AgentSpec, signal?: AbortSignal): Promise<TrueForgeAgentRecord> {
    return (await this.#client.agents.create({ name, manifest }, requestOptions(signal))).data;
  }

  async updateAgent(id: string, manifest: TrueForgeApi.AgentSpec, signal?: AbortSignal): Promise<TrueForgeAgentRecord> {
    return (await this.#client.agents.update(id, { manifest }, requestOptions(signal))).data;
  }

  async createSession(agentName: string, signal?: AbortSignal): Promise<{ id: string }> {
    return (await this.#client.sessions.create({ agent: { name: agentName } }, requestOptions(signal))).data;
  }

  async streamTurn(
    sessionId: string,
    input: readonly TrueForgeTurnInput[],
    previousTurnId?: string,
    signal?: AbortSignal,
  ): Promise<AsyncIterable<TrueForgeStreamItem>> {
    const request: TrueForgeApi.sessions.CreateTurnSessionsStreamRequest = {
      input: [...input],
      ...(previousTurnId === undefined ? {} : { previousTurnId }),
    };
    const stream = await this.#client.sessions.createTurnStream(
      sessionId,
      request,
      signal === undefined ? undefined : { abortSignal: signal },
    );
    return streamWithMetadata(stream);
  }

  async startTurn(sessionId: string, input: readonly TrueForgeTurnInput[], signal?: AbortSignal): Promise<{ id: string }> {
    return (await this.#client.sessions.createTurn(sessionId, { input: [...input] }, requestOptions(signal))).data;
  }

  async getTurn(sessionId: string, turnId: string, signal?: AbortSignal): Promise<unknown> {
    return (await this.#client.sessions.getTurn(sessionId, turnId, requestOptions(signal))).data;
  }

  async listTurnEvents(sessionId: string, turnId: string, signal?: AbortSignal): Promise<readonly unknown[]> {
    const page = await this.#client.sessions.listTurnEvents(
      sessionId,
      turnId,
      { limit: 100, order: "asc" },
      requestOptions(signal),
    );
    return page.data;
  }

  async subscribeToTurn(
    sessionId: string,
    turnId: string,
    afterSequenceNumber: number,
    signal?: AbortSignal,
  ): Promise<AsyncIterable<TrueForgeStreamItem>> {
    const stream = await this.#client.sessions.subscribeToTurn(
      sessionId,
      turnId,
      { afterSequenceNumber },
      signal === undefined ? undefined : { abortSignal: signal },
    );
    return streamWithMetadata(stream);
  }

  async cancelSession(sessionId: string): Promise<unknown> {
    return this.#client.sessions.cancel(sessionId);
  }
}
