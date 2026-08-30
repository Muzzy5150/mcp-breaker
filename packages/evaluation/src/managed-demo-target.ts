import { DemoToolService, startDemoMcpHttpServer, type RunningDemoMcpHttpServer } from "@mcp-breaker/demo-target";

export const MANAGED_DEMO_MCP_URL = "http://127.0.0.1:18880/mcp";

export class ManagedDemoTargetBusyError extends Error {
  override readonly name = "ManagedDemoTargetBusyError";
}

export interface ManagedDemoTargetLease {
  server: RunningDemoMcpHttpServer;
  release(): Promise<void>;
}

let leaseActive = false;

/**
 * The single ownership boundary for the disposable port-18880 demo target.
 * It never terminates an existing listener and only closes the server it starts.
 */
export async function acquireManagedDemoTarget(): Promise<ManagedDemoTargetLease> {
  if (leaseActive) {
    throw new ManagedDemoTargetBusyError("The managed demo target is already in use by another MCP Breaker action.");
  }
  leaseActive = true;
  let server: RunningDemoMcpHttpServer;
  try {
    server = await startDemoMcpHttpServer({
      host: "127.0.0.1",
      port: 18_880,
      service: new DemoToolService(),
    });
  } catch (error) {
    leaseActive = false;
    throw error;
  }

  let released = false;
  return {
    server,
    release: async () => {
      if (released) {
        return;
      }
      released = true;
      try {
        await server.close();
      } finally {
        leaseActive = false;
      }
    },
  };
}
