import { Client, StreamableHTTPClientTransport, type Tool } from "@modelcontextprotocol/client";
import { DEMO_TOOL_METADATA } from "@mcp-breaker/demo-target";

import { MANAGED_DEMO_TARGET_NAME } from "./managed-demo-job.js";
import { acquireManagedDemoTarget, MANAGED_DEMO_MCP_URL } from "./managed-demo-target.js";

const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const CONNECTION_TIMEOUT_MS = 8_000;

export class McpInspectionValidationError extends Error {
  override readonly name = "McpInspectionValidationError";
}
export class McpInspectionConnectionError extends Error {
  override readonly name = "McpInspectionConnectionError";
}

export type McpInspectionRisk =
  | "READ_ONLY"
  | "WRITE"
  | "DESTRUCTIVE"
  | "PRIVILEGED"
  | "EXTERNAL_COMMUNICATION"
  | "CODE_EXECUTION"
  | "UNCLASSIFIED";

export interface McpInspectedTool {
  name: string;
  description: string;
  riskClasses: McpInspectionRisk[];
  annotations?: Tool["annotations"];
  inputSchema: Tool["inputSchema"];
  outputSchema?: Tool["outputSchema"];
}

export interface McpInspectionResult {
  connectionStatus: "CONNECTED";
  serverUrl: string;
  targetName: string;
  serverName: string;
  managedDemoTarget: boolean;
  toolCount: number;
  tools: McpInspectedTool[];
}

export function validateMcpServerUrl(rawUrl: unknown): URL {
  if (typeof rawUrl !== "string" || rawUrl.trim().length === 0) {
    throw new McpInspectionValidationError("MCP server URL is required.");
  }
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new McpInspectionValidationError("Enter a valid MCP server URL.");
  }
  if (url.protocol !== "http:") {
    throw new McpInspectionValidationError("This hackathon build accepts loopback HTTP MCP servers only.");
  }
  if (!ALLOWED_HOSTS.has(url.hostname)) {
    throw new McpInspectionValidationError("Only localhost, 127.0.0.1, and ::1 MCP servers are allowed.");
  }
  if (url.username !== "" || url.password !== "") {
    throw new McpInspectionValidationError("Authentication in MCP server URLs is not supported in this build.");
  }
  url.hash = "";
  return url;
}

function inferToolRisks(tool: Tool, isManagedDemo: boolean): McpInspectionRisk[] {
  if (isManagedDemo) {
    const metadata = DEMO_TOOL_METADATA.find((candidate) => candidate.name === tool.name);
    if (metadata !== undefined) {
      return [...metadata.riskClasses];
    }
  }
  if (tool.annotations?.readOnlyHint === true) {
    return ["READ_ONLY"];
  }
  const risks: McpInspectionRisk[] = [];
  if (tool.annotations?.readOnlyHint === false || tool.annotations?.destructiveHint === true) {
    risks.push("WRITE");
  }
  if (tool.annotations?.destructiveHint === true) {
    risks.push("DESTRUCTIVE");
  }
  if (tool.annotations?.openWorldHint === true) {
    risks.push("EXTERNAL_COMMUNICATION");
  }
  return risks.length === 0 ? ["UNCLASSIFIED"] : risks;
}

function requestUrl(input: string | URL | Request): URL {
  return validateMcpServerUrl(input instanceof Request ? input.url : input.toString());
}

function guardedLoopbackFetch(timeout: AbortSignal): typeof fetch {
  return async (input, init) => {
    requestUrl(input);
    const signal = init?.signal == null ? timeout : AbortSignal.any([init.signal, timeout]);
    const response = await fetch(input, { ...init, redirect: "manual", signal });
    if (response.status >= 300 && response.status < 400) {
      throw new McpInspectionConnectionError("MCP inspection does not follow redirects.");
    }
    return response;
  };
}

export async function inspectMcpServer(rawUrl: unknown): Promise<McpInspectionResult> {
  const url = validateMcpServerUrl(rawUrl);
  const client = new Client({ name: "mcp-breaker-inspector", version: "0.1.0" });
  const timeout = AbortSignal.timeout(CONNECTION_TIMEOUT_MS);
  const transport = new StreamableHTTPClientTransport(url, { fetch: guardedLoopbackFetch(timeout) });
  try {
    await client.connect(transport, { signal: timeout });
    const discoveredTools: Tool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 100; page += 1) {
      const listed = await client.listTools(cursor === undefined ? undefined : { cursor }, { signal: timeout });
      discoveredTools.push(...listed.tools);
      cursor = listed.nextCursor;
      if (cursor === undefined) {
        break;
      }
      if (page === 99) {
        throw new McpInspectionConnectionError("MCP tool discovery exceeded the 100-page safety limit.");
      }
    }
    const serverVersion = client.getServerVersion();
    const serverName = serverVersion?.name ?? "Local MCP Server";
    const managedDemoTarget = serverName === "mcp-breaker-demo-target";
    const tools = discoveredTools.map((tool): McpInspectedTool => ({
      name: tool.name,
      description: tool.description ?? "No description provided by the MCP server.",
      riskClasses: inferToolRisks(tool, managedDemoTarget),
      ...(tool.annotations === undefined ? {} : { annotations: tool.annotations }),
      inputSchema: tool.inputSchema,
      ...(tool.outputSchema === undefined ? {} : { outputSchema: tool.outputSchema }),
    }));
    return {
      connectionStatus: "CONNECTED",
      serverUrl: url.toString(),
      targetName: managedDemoTarget ? MANAGED_DEMO_TARGET_NAME : serverName,
      serverName,
      managedDemoTarget,
      toolCount: tools.length,
      tools,
    };
  } catch (error) {
    if (error instanceof McpInspectionConnectionError) {
      throw error;
    }
    const message = error instanceof Error && error.name === "TimeoutError"
      ? "The MCP server did not complete initialization and tool discovery within 8 seconds."
      : "MCP initialization or tool discovery failed. Confirm the loopback server is running and exposes Streamable HTTP MCP.";
    throw new McpInspectionConnectionError(message, { cause: error });
  } finally {
    await Promise.allSettled([client.close()]);
  }
}

export async function inspectManagedMcpServer(rawUrl: unknown): Promise<McpInspectionResult> {
  const url = validateMcpServerUrl(rawUrl);
  if (url.toString() !== MANAGED_DEMO_MCP_URL) {
    return inspectMcpServer(url.toString());
  }
  let lease;
  try {
    lease = await acquireManagedDemoTarget();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EADDRINUSE") {
      return inspectMcpServer(url.toString());
    }
    throw error;
  }
  try {
    return await inspectMcpServer(lease.server.url);
  } finally {
    await lease.release();
  }
}
