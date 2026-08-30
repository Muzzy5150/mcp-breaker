import { createServer, type Server } from "node:http";

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { startDemoMcpHttpServer, type RunningDemoMcpHttpServer } from "@mcp-breaker/demo-target";

import {
  inspectManagedMcpServer,
  inspectMcpServer,
  MANAGED_DEMO_MCP_URL,
  McpInspectionConnectionError,
  McpInspectionValidationError,
  validateMcpServerUrl,
  type McpInspectionResult,
} from "@mcp-breaker/evaluation";

import { McpInspectionErrorPanel, McpInspectionResultPanel } from "../apps/dashboard/src/components/mcp-connect-panel.js";

let redirectServer: Server | undefined;
let standaloneDemo: RunningDemoMcpHttpServer | undefined;

afterEach(async () => {
  if (redirectServer !== undefined) {
    await new Promise<void>((resolve, reject) => redirectServer?.close((error) => error === undefined ? resolve() : reject(error)));
    redirectServer = undefined;
  }
  await standaloneDemo?.close();
  standaloneDemo = undefined;
});

describe("final loopback MCP connect UX", () => {
  it("accepts only the explicit loopback host allowlist", () => {
    expect(validateMcpServerUrl("http://localhost:18880/mcp").hostname).toBe("127.0.0.1");
    expect(validateMcpServerUrl("http://127.0.0.1:18880/mcp").hostname).toBe("127.0.0.1");
    expect(validateMcpServerUrl("http://[::1]:18880/mcp").hostname).toBe("[::1]");
    expect(() => validateMcpServerUrl("https://example.com/mcp")).toThrow(McpInspectionValidationError);
    expect(() => validateMcpServerUrl("http://192.168.1.20/mcp")).toThrow("Only localhost");
    expect(() => validateMcpServerUrl("http://user:secret@localhost:18880/mcp")).toThrow("Authentication");
  });

  it("does not trust a directly inspected server that spoofs the managed demo name", async () => {
    standaloneDemo = await startDemoMcpHttpServer();
    const result = await inspectMcpServer(standaloneDemo.url);
    expect(result.serverName).toBe("mcp-breaker-demo-target");
    expect(result.managedDemoTarget).toBe(false);
    expect(result.targetName).toBe("mcp-breaker-demo-target");
    expect(result.tools.find((tool) => tool.name === "merge_pull_request")?.riskClasses).toEqual([
      "WRITE",
      "DESTRUCTIVE",
    ]);
  });

  it("temporarily starts the actual managed demo target and discovers its real tools", async () => {
    const result = await inspectManagedMcpServer(MANAGED_DEMO_MCP_URL);
    expect(result.connectionStatus).toBe("CONNECTED");
    expect(result.targetName).toBe("MCP Breaker Demo Target");
    expect(result.managedDemoTarget).toBe(true);
    expect(result.toolCount).toBe(11);
    expect(result.tools.map((tool) => tool.name)).toContain("merge_pull_request");
    expect(result.tools.find((tool) => tool.name === "merge_pull_request")?.riskClasses).toEqual([
      "WRITE",
      "DESTRUCTIVE",
      "PRIVILEGED",
    ]);
    expect(result.tools.every((tool) => tool.inputSchema !== undefined)).toBe(true);
  });

  it("reports a real connection failure instead of a connected state", async () => {
    await expect(inspectMcpServer("http://127.0.0.1:1/mcp")).rejects.toThrow(McpInspectionConnectionError);
    const html = renderToStaticMarkup(<McpInspectionErrorPanel message="Fixture connection refused." />);
    expect(html).toContain("Connection failed:");
    expect(html).toContain("Fixture connection refused.");
    expect(html).not.toContain("CONNECTED");
  });

  it("does not follow a loopback redirect to an external target", async () => {
    redirectServer = createServer((_request, response) => {
      response.writeHead(302, { location: "https://example.com/mcp" }).end();
    });
    await new Promise<void>((resolve, reject) => {
      redirectServer?.once("error", reject);
      redirectServer?.listen(0, "127.0.0.1", () => resolve());
    });
    const address = redirectServer.address();
    if (address === null || typeof address === "string") {
      throw new Error("Redirect test server did not receive a port.");
    }
    await expect(inspectMcpServer(`http://127.0.0.1:${address.port}/mcp`)).rejects.toThrow("does not follow redirects");
  });

  it("renders discovered tool names from the API result data", () => {
    const result: McpInspectionResult = {
      connectionStatus: "CONNECTED",
      serverUrl: "http://localhost:9999/mcp",
      targetName: "Fixture MCP",
      serverName: "fixture-mcp",
      managedDemoTarget: false,
      toolCount: 1,
      tools: [{
        name: "api_discovered_tool",
        description: "Supplied by the inspection response.",
        riskClasses: ["UNCLASSIFIED"],
        annotations: { readOnlyHint: false },
        inputSchema: { type: "object" },
        outputSchema: { type: "object" },
      }],
    };
    const html = renderToStaticMarkup(
      <McpInspectionResultPanel
        result={result}
        assessmentDisabled={false}
        assessmentActive={false}
        onRunAssessment={() => undefined}
      />,
    );
    expect(html).toContain("api_discovered_tool");
    expect(html).toContain("Supplied by the inspection response.");
    expect(html).toContain("Input schema");
    expect(html).toContain("Output schema");
    expect(html).toContain("Annotations");
    expect(html).not.toContain("read_issue");
    expect(html).not.toContain("Run Security Assessment");
  });
});
