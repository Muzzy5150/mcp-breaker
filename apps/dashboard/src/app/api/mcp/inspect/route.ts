import {
  inspectManagedMcpServer,
  McpInspectionConnectionError,
  McpInspectionValidationError,
  ManagedDemoTargetBusyError,
} from "@mcp-breaker/evaluation";

import { jobResponse, localMutationError } from "@/lib/demo-job";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const rejected = localMutationError(request);
  if (rejected !== undefined) {
    return rejected;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jobResponse({ connectionStatus: "FAILED", error: "Request body must be valid JSON." }, 400);
  }
  const url = typeof body === "object" && body !== null && "url" in body
    ? (body as { url?: unknown }).url
    : undefined;

  try {
    return jobResponse(await inspectManagedMcpServer(url));
  } catch (error) {
    if (error instanceof McpInspectionValidationError || error instanceof Error && error.name === "McpInspectionValidationError") {
      return jobResponse({ connectionStatus: "FAILED", error: error.message }, 400);
    }
    if (error instanceof ManagedDemoTargetBusyError || error instanceof Error && error.name === "ManagedDemoTargetBusyError") {
      return jobResponse({ connectionStatus: "FAILED", error: error.message }, 409);
    }
    if (error instanceof McpInspectionConnectionError || error instanceof Error && error.name === "McpInspectionConnectionError") {
      return jobResponse({ connectionStatus: "FAILED", error: error.message }, 502);
    }
    const message = error instanceof Error && "code" in error && error.code === "EADDRINUSE"
      ? "Port 18880 is already occupied. MCP Breaker did not terminate that process. Stop it or inspect the MCP server already listening there."
      : error instanceof Error ? error.message : "MCP inspection failed.";
    return jobResponse({ connectionStatus: "FAILED", error: message }, 502);
  }
}
