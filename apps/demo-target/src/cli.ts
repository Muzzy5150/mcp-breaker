import { startDemoMcpHttpServer } from "./mcp-server.js";

function parsePort(raw: string | undefined): number {
  if (raw === undefined) {
    return 18880;
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`PORT must be an integer from 1 to 65535; received ${raw}.`);
  }
  return port;
}

const host = "127.0.0.1";
const port = parsePort(process.env["PORT"]);
const running = await startDemoMcpHttpServer({ host, port });
process.stdout.write(`MCP Breaker demo target listening at ${running.url}\n`);

async function shutdown(): Promise<void> {
  await running.close();
  process.exitCode = 0;
}

process.once("SIGINT", () => {
  void shutdown();
});
process.once("SIGTERM", () => {
  void shutdown();
});
