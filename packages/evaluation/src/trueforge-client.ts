import { TrueForge, type TrueForgeApi } from "@truefoundry/trueforge-sdk";

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
  getCapabilities(): Promise<unknown>;
  listModels(): Promise<readonly { name: string }[]>;
  listMcpServers(): Promise<readonly { name: string; url: string; authStatus: unknown }[]>;
  listMcpTools(name: string): Promise<readonly Record<string, unknown>[]>;
  getSandboxProvider(): Promise<{ type: string; status: string; statusReason: string | null }>;
  listAgents(): Promise<readonly TrueForgeAgentRecord[]>;
  createAgent(name: string, manifest: TrueForgeApi.AgentSpec): Promise<TrueForgeAgentRecord>;
  updateAgent(id: string, manifest: TrueForgeApi.AgentSpec): Promise<TrueForgeAgentRecord>;
  createSession(agentName: string): Promise<{ id: string }>;
  streamTurn(
    sessionId: string,
    input: readonly TrueForgeTurnInput[],
    previousTurnId?: string,
    signal?: AbortSignal,
  ): Promise<AsyncIterable<TrueForgeStreamItem>>;
  startTurn(sessionId: string, input: readonly TrueForgeTurnInput[]): Promise<{ id: string }>;
  getTurn(sessionId: string, turnId: string): Promise<unknown>;
  listTurnEvents(sessionId: string, turnId: string): Promise<readonly unknown[]>;
  subscribeToTurn(
    sessionId: string,
    turnId: string,
    afterSequenceNumber: number,
    signal?: AbortSignal,
  ): Promise<AsyncIterable<TrueForgeStreamItem>>;
  cancelSession(sessionId: string): Promise<unknown>;
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
    this.#client = new TrueForge({ baseUrl, ...(token === undefined ? {} : { token }), timeoutInSeconds: 600 });
  }

  async getCapabilities(): Promise<unknown> {
    return (await this.#client.server.getCapabilities()).data;
  }

  async listModels(): Promise<readonly { name: string }[]> {
    return (await this.#client.models.list()).data;
  }

  async listMcpServers(): Promise<readonly { name: string; url: string; authStatus: unknown }[]> {
    return (await this.#client.mcpServers.list()).data;
  }

  async listMcpTools(name: string): Promise<readonly Record<string, unknown>[]> {
    return (await this.#client.mcpServers.listTools(name)).data;
  }

  async getSandboxProvider(): Promise<{ type: string; status: string; statusReason: string | null }> {
    const response = await this.#client.settings.sandboxProviders.get();
    return {
      type: response.data.manifest.type,
      status: response.data.status,
      statusReason: response.data.statusReason,
    };
  }

  async listAgents(): Promise<readonly TrueForgeAgentRecord[]> {
    return (await this.#client.agents.list()).data;
  }

  async createAgent(name: string, manifest: TrueForgeApi.AgentSpec): Promise<TrueForgeAgentRecord> {
    return (await this.#client.agents.create({ name, manifest })).data;
  }

  async updateAgent(id: string, manifest: TrueForgeApi.AgentSpec): Promise<TrueForgeAgentRecord> {
    return (await this.#client.agents.update(id, { manifest })).data;
  }

  async createSession(agentName: string): Promise<{ id: string }> {
    return (await this.#client.sessions.create({ agent: { name: agentName } })).data;
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

  async startTurn(sessionId: string, input: readonly TrueForgeTurnInput[]): Promise<{ id: string }> {
    return (await this.#client.sessions.createTurn(sessionId, { input: [...input] })).data;
  }

  async getTurn(sessionId: string, turnId: string): Promise<unknown> {
    return (await this.#client.sessions.getTurn(sessionId, turnId)).data;
  }

  async listTurnEvents(sessionId: string, turnId: string): Promise<readonly unknown[]> {
    const page = await this.#client.sessions.listTurnEvents(sessionId, turnId, { limit: 100, order: "asc" });
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
