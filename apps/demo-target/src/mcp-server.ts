import { createServer, type IncomingMessage, type Server as HttpServer } from "node:http";

import { localhostHostValidation, localhostOriginValidation, toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";

import { DEMO_TOOL_METADATA, type DemoToolName, getDemoToolMetadata } from "./metadata.js";
import { DemoToolInputSchemas, DemoToolService } from "./tools.js";

function toolAnnotations(name: DemoToolName) {
  const metadata = getDemoToolMetadata(name);
  return {
    title: metadata.name,
    readOnlyHint: metadata.riskClasses.length === 1 && metadata.riskClasses[0] === "READ_ONLY",
    destructiveHint: metadata.riskClasses.includes("DESTRUCTIVE"),
    idempotentHint: metadata.riskClasses.includes("READ_ONLY") || name === "reset_demo_state",
  };
}

function resultContent(result: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
}

async function executeMcpTool(service: DemoToolService, name: DemoToolName, args: unknown) {
  const output = await service.invokeStandalone(name, args, {
    sessionId: "demo-mcp-session",
    testId: "manual-mcp-call",
    provenance: "RUNTIME",
  });
  return resultContent(output.result);
}

export function createDemoMcpServer(service: DemoToolService): McpServer {
  const server = new McpServer({ name: "mcp-breaker-demo-target", version: "0.1.0" });

  server.registerTool(
    "list_issues",
    { description: getDemoToolMetadata("list_issues").description, inputSchema: DemoToolInputSchemas.list_issues, annotations: toolAnnotations("list_issues") },
    async (args) => executeMcpTool(service, "list_issues", args),
  );
  server.registerTool(
    "read_issue",
    { description: getDemoToolMetadata("read_issue").description, inputSchema: DemoToolInputSchemas.read_issue, annotations: toolAnnotations("read_issue") },
    async (args) => executeMcpTool(service, "read_issue", args),
  );
  server.registerTool(
    "read_pull_request",
    { description: getDemoToolMetadata("read_pull_request").description, inputSchema: DemoToolInputSchemas.read_pull_request, annotations: toolAnnotations("read_pull_request") },
    async (args) => executeMcpTool(service, "read_pull_request", args),
  );
  server.registerTool(
    "read_file",
    { description: getDemoToolMetadata("read_file").description, inputSchema: DemoToolInputSchemas.read_file, annotations: toolAnnotations("read_file") },
    async (args) => executeMcpTool(service, "read_file", args),
  );
  server.registerTool(
    "list_files",
    { description: getDemoToolMetadata("list_files").description, inputSchema: DemoToolInputSchemas.list_files, annotations: toolAnnotations("list_files") },
    async (args) => executeMcpTool(service, "list_files", args),
  );
  server.registerTool(
    "write_file",
    { description: getDemoToolMetadata("write_file").description, inputSchema: DemoToolInputSchemas.write_file, annotations: toolAnnotations("write_file") },
    async (args) => executeMcpTool(service, "write_file", args),
  );
  server.registerTool(
    "delete_file",
    { description: getDemoToolMetadata("delete_file").description, inputSchema: DemoToolInputSchemas.delete_file, annotations: toolAnnotations("delete_file") },
    async (args) => executeMcpTool(service, "delete_file", args),
  );
  server.registerTool(
    "create_pull_request",
    { description: getDemoToolMetadata("create_pull_request").description, inputSchema: DemoToolInputSchemas.create_pull_request, annotations: toolAnnotations("create_pull_request") },
    async (args) => executeMcpTool(service, "create_pull_request", args),
  );
  server.registerTool(
    "merge_pull_request",
    { description: getDemoToolMetadata("merge_pull_request").description, inputSchema: DemoToolInputSchemas.merge_pull_request, annotations: toolAnnotations("merge_pull_request") },
    async (args) => executeMcpTool(service, "merge_pull_request", args),
  );
  server.registerTool(
    "send_message",
    { description: getDemoToolMetadata("send_message").description, inputSchema: DemoToolInputSchemas.send_message, annotations: toolAnnotations("send_message") },
    async (args) => executeMcpTool(service, "send_message", args),
  );
  server.registerTool(
    "reset_demo_state",
    { description: getDemoToolMetadata("reset_demo_state").description, inputSchema: DemoToolInputSchemas.reset_demo_state, annotations: toolAnnotations("reset_demo_state") },
    async (args) => executeMcpTool(service, "reset_demo_state", args),
  );

  if (server === undefined || DEMO_TOOL_METADATA.length === 0) {
    throw new Error("Demo MCP server could not be initialized.");
  }
  return server;
}

export interface DemoMcpHttpServerOptions {
  host?: string;
  port?: number;
  service?: DemoToolService;
}

export interface RunningDemoMcpHttpServer {
  url: string;
  service: DemoToolService;
  close(): Promise<void>;
}

function assertLoopbackHost(host: string): void {
  if (host !== "127.0.0.1" && host !== "::1") {
    throw new Error(`Demo MCP server host must be a loopback address; received ${host}.`);
  }
}

export function formatDemoMcpUrl(host: string, port: number): string {
  assertLoopbackHost(host);
  const urlHost = host === "::1" ? "[::1]" : host;
  return `http://${urlHost}:${port}/mcp`;
}

function hasRequestLine(request: IncomingMessage): request is IncomingMessage & { method: string; url: string } {
  return request.method !== undefined && request.url !== undefined;
}

function closeHttpServer(server: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    });
  });
}

export async function startDemoMcpHttpServer(
  options: DemoMcpHttpServerOptions = {},
): Promise<RunningDemoMcpHttpServer> {
  const host = options.host ?? "127.0.0.1";
  assertLoopbackHost(host);
  const port = options.port ?? 0;
  const service = options.service ?? new DemoToolService();
  const handler = createMcpHandler(() => createDemoMcpServer(service));
  const nodeHandler = toNodeHandler(handler);
  const validateHost = localhostHostValidation();
  const validateOrigin = localhostOriginValidation();

  const httpServer = createServer((request, response) => {
    if (!hasRequestLine(request)) {
      response.writeHead(400, { "content-type": "text/plain" }).end("Missing HTTP request line");
      return;
    }
    const path = request.url.split("?", 1)[0];
    if (path === "/healthz" && request.method === "GET") {
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (path !== "/mcp") {
      response.writeHead(404, { "content-type": "text/plain" }).end("Not found");
      return;
    }
    if (!validateHost(request, response) || !validateOrigin(request, response)) {
      return;
    }
    void nodeHandler(request, response);
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => {
      httpServer.off("error", reject);
      resolve();
    });
  });

  const address = httpServer.address();
  if (address === null || typeof address === "string") {
    await closeHttpServer(httpServer);
    await handler.close();
    throw new Error("Demo MCP server did not receive a TCP address.");
  }
  const actualPort = address.port;
  let closed = false;
  return {
    url: formatDemoMcpUrl(host, actualPort),
    service,
    close: async () => {
      if (closed) {
        return;
      }
      closed = true;
      await handler.close();
      await closeHttpServer(httpServer);
    },
  };
}
