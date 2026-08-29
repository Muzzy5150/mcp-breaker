import { DEMO_TOOL_NAMES } from "@mcp-breaker/demo-target";

import {
  SMOKE_AGENT_NAME,
  TRUEFORGE_CONNECTOR,
  TRUEFORGE_CONNECTOR_URL,
  TRUEFORGE_MODEL,
} from "./trueforge-agents.js";
import type { TrueForgeFacade } from "./trueforge-client.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export interface TrueForgeDoctorReport {
  ok: boolean;
  checks: {
    server: boolean;
    model: boolean;
    connector: boolean;
    connectorAuthorized: boolean;
    connectorTools: boolean;
    outputSchemas: boolean;
    sandbox: boolean;
    smokeAgentPreserved: boolean;
  };
  model: string;
  connector: { name: string; url: string; authStatus: string };
  sandbox: { type: string; status: string; statusReason: string | null };
  toolNames: string[];
  missingOutputSchemas: string[];
  messages: string[];
}

export async function runTrueForgeDoctor(client: TrueForgeFacade): Promise<TrueForgeDoctorReport> {
  const [capabilities, models, connectors, sandbox, agents] = await Promise.all([
    client.getCapabilities(),
    client.listModels(),
    client.listMcpServers(),
    client.getSandboxProvider(),
    client.listAgents(),
  ]);
  const connector = connectors.find((candidate) => candidate.name === TRUEFORGE_CONNECTOR);
  const tools = connector === undefined ? [] : await client.listMcpTools(connector.name);
  const toolNames = tools
    .map((tool) => (typeof tool.name === "string" ? tool.name : ""))
    .filter(Boolean)
    .sort();
  const missingOutputSchemas = tools
    .filter((tool) => typeof tool.name === "string" && !isRecord(tool.outputSchema))
    .map((tool) => String(tool.name))
    .sort();
  const capabilitiesRecord = isRecord(capabilities) ? capabilities : {};
  const sandboxCapability = isRecord(capabilitiesRecord.sandbox) ? capabilitiesRecord.sandbox : {};
  const authStatusRecord = connector !== undefined && isRecord(connector.authStatus) ? connector.authStatus : {};
  const authStatus = typeof authStatusRecord.status === "string" ? authStatusRecord.status : "unknown";
  const checks = {
    server: sandboxCapability.enabled === true,
    model: models.some((model) => model.name === TRUEFORGE_MODEL),
    connector: connector?.url === TRUEFORGE_CONNECTOR_URL,
    connectorAuthorized: authStatus === "not_required" || authStatus === "authorized",
    connectorTools: DEMO_TOOL_NAMES.every((name) => toolNames.includes(name)),
    outputSchemas: missingOutputSchemas.length === 0 && tools.length === DEMO_TOOL_NAMES.length,
    sandbox: sandbox.type === "daytona" && sandbox.status === "ready",
    smokeAgentPreserved: agents.some((agent) => agent.name === SMOKE_AGENT_NAME),
  };
  const messages = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => `Failed TrueForge preflight check: ${name}.`);
  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    model: TRUEFORGE_MODEL,
    connector: {
      name: connector?.name ?? TRUEFORGE_CONNECTOR,
      url: connector?.url ?? "missing",
      authStatus,
    },
    sandbox,
    toolNames,
    missingOutputSchemas,
    messages,
  };
}
