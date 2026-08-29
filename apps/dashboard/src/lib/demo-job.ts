import { createManagedDemoJobManager, type ManagedDemoJobManager } from "@mcp-breaker/evaluation";

declare global {
  var __mcpBreakerManagedDemoJob: ManagedDemoJobManager | undefined;
}

export function getManagedDemoJob(): ManagedDemoJobManager {
  globalThis.__mcpBreakerManagedDemoJob ??= createManagedDemoJobManager();
  return globalThis.__mcpBreakerManagedDemoJob;
}

export function localMutationError(request: Request): Response | undefined {
  const origin = request.headers.get("origin");
  if (origin === null) {
    return undefined;
  }
  try {
    const url = new URL(origin);
    const allowedHost = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
    if (url.protocol === "http:" && allowedHost && url.port === "3000") {
      return undefined;
    }
  } catch {
    // Invalid origins are rejected below.
  }
  return Response.json(
    { error: "Managed demo actions are only available from the local MCP Breaker website." },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
}

export function jobResponse(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}
