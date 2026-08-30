import { DEMO_TOOL_NAMES, DemoToolOutputSchemas, type DemoToolName } from "@mcp-breaker/demo-target";
import { z } from "zod";

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

function isDemoToolName(value: string): value is DemoToolName {
  return (DEMO_TOOL_NAMES as readonly string[]).includes(value);
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalJson);
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(
      ([key, entry]) => [key, canonicalJson(entry)],
    ),
  );
}

function schemaMatches(toolName: DemoToolName, actual: unknown): boolean {
  return JSON.stringify(canonicalJson(actual)) === JSON.stringify(
    canonicalJson(z.toJSONSchema(DemoToolOutputSchemas[toolName])),
  );
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
  invalidOutputSchemas: string[];
  messages: string[];
}

export interface TrueForgePlatformReadiness {
  ok: boolean;
  checkedAt: string;
  checks: {
    server: boolean;
    model: boolean;
    connector: boolean;
    connectorAuthorized: boolean;
    sandbox: boolean;
    smokeAgentPreserved: boolean;
  };
  model: string;
  connector: { name: string; url: string; authStatus: string };
  sandbox: { type: string; status: string; statusReason: string | null };
  messages: string[];
}

export async function runTrueForgePlatformReadiness(
  client: TrueForgeFacade,
  signal?: AbortSignal,
): Promise<TrueForgePlatformReadiness> {
  const [capabilities, models, connectors, sandbox, agents] = await Promise.all([
    client.getCapabilities(signal),
    client.listModels(signal),
    client.listMcpServers(signal),
    client.getSandboxProvider(signal),
    client.listAgents(signal),
  ]);
  const connector = connectors.find((candidate) => candidate.name === TRUEFORGE_CONNECTOR);
  const capabilitiesRecord = isRecord(capabilities) ? capabilities : {};
  const sandboxCapability = isRecord(capabilitiesRecord.sandbox) ? capabilitiesRecord.sandbox : {};
  const authStatusRecord = connector !== undefined && isRecord(connector.authStatus) ? connector.authStatus : {};
  const authStatus = typeof authStatusRecord.status === "string" ? authStatusRecord.status : "unknown";
  const checks = {
    server: sandboxCapability.enabled === true,
    model: models.some((model) => model.name === TRUEFORGE_MODEL),
    connector: connector?.url === TRUEFORGE_CONNECTOR_URL,
    connectorAuthorized: authStatus === "not_required" || authStatus === "authorized",
    sandbox: sandbox.type === "daytona" && sandbox.status === "ready",
    smokeAgentPreserved: agents.some((agent) => agent.name === SMOKE_AGENT_NAME),
  };
  const messages = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => `Failed TrueForge readiness check: ${name}.`);
  return {
    ok: Object.values(checks).every(Boolean),
    checkedAt: new Date().toISOString(),
    checks,
    model: TRUEFORGE_MODEL,
    connector: {
      name: connector?.name ?? TRUEFORGE_CONNECTOR,
      url: connector?.url ?? "missing",
      authStatus,
    },
    sandbox,
    messages,
  };
}

export async function runTrueForgeDoctor(
  client: TrueForgeFacade,
  options: { readiness?: TrueForgePlatformReadiness; signal?: AbortSignal } = {},
): Promise<TrueForgeDoctorReport> {
  const readiness = options.readiness ?? await runTrueForgePlatformReadiness(client, options.signal);
  const tools = readiness.checks.connector
    ? await client.listMcpTools(readiness.connector.name, options.signal)
    : [];
  const toolNames = tools
    .map((tool) => (typeof tool.name === "string" ? tool.name : ""))
    .filter(Boolean)
    .sort();
  const missingOutputSchemas = tools
    .filter((tool) => typeof tool.name === "string" && !isRecord(tool.outputSchema))
    .map((tool) => String(tool.name))
    .sort();
  const invalidOutputSchemas = tools
    .filter((tool) => {
      const name = typeof tool.name === "string" ? tool.name : "";
      return isDemoToolName(name) && isRecord(tool.outputSchema) && !schemaMatches(name, tool.outputSchema);
    })
    .map((tool) => String(tool.name))
    .sort();
  const checks = {
    ...readiness.checks,
    connectorTools: DEMO_TOOL_NAMES.every((name) => toolNames.includes(name)),
    outputSchemas:
      missingOutputSchemas.length === 0 &&
      invalidOutputSchemas.length === 0 &&
      tools.length === DEMO_TOOL_NAMES.length,
  };
  const messages = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => `Failed TrueForge preflight check: ${name}.`);
  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    model: TRUEFORGE_MODEL,
    connector: {
      name: readiness.connector.name,
      url: readiness.connector.url,
      authStatus: readiness.connector.authStatus,
    },
    sandbox: readiness.sandbox,
    toolNames,
    missingOutputSchemas,
    invalidOutputSchemas,
    messages,
  };
}
