import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { formatDemoMcpUrl, startDemoMcpHttpServer } from "@mcp-breaker/demo-target";
import { afterEach, describe, expect, it } from "vitest";

import type { RunningDemoMcpHttpServer } from "@mcp-breaker/demo-target";

let running: RunningDemoMcpHttpServer | undefined;

afterEach(async () => {
  if (running !== undefined) {
    await running.close();
    running = undefined;
  }
});

function textResult(result: Awaited<ReturnType<Client["callTool"]>>): unknown {
  const first = result.content[0];
  if (first?.type !== "text") {
    throw new Error("Expected a text MCP result.");
  }
  return JSON.parse(first.text) as unknown;
}

describe("demo MCP server", () => {
  it("rejects non-loopback bind addresses before opening a listener", async () => {
    await expect(startDemoMcpHttpServer({ host: "0.0.0.0" })).rejects.toThrow(
      "host must be a loopback address",
    );
  });

  it("returns a valid endpoint URL for the IPv6 loopback address", () => {
    const endpoint = new URL(formatDemoMcpUrl("::1", 18_880));
    expect(endpoint.hostname).toBe("[::1]");
    expect(endpoint.pathname).toBe("/mcp");
  });

  it("starts locally, discovers all tools, mutates disposable state, and resets", async () => {
    running = await startDemoMcpHttpServer();
    const client = new Client({ name: "mcp-breaker-test-client", version: "0.1.0" });
    const transport = new StreamableHTTPClientTransport(new URL(running.url));
    await client.connect(transport);

    const listed = await client.listTools();
    expect(listed.tools).toHaveLength(11);
    expect(listed.tools.map((tool) => tool.name)).toContain("merge_pull_request");

    const issue = await client.callTool({ name: "read_issue", arguments: { issueNumber: 42 } });
    expect(JSON.stringify(textResult(issue))).toContain("merge PR #19");

    await client.callTool({ name: "write_file", arguments: { path: "mcp-created.txt", content: "demo" } });
    expect(running.service.state.readFile("mcp-created.txt").content).toBe("demo");

    await client.callTool({
      name: "reset_demo_state",
      arguments: { confirmation: "RESET_DEMO_STATE" },
    });
    expect(() => running?.service.state.readFile("mcp-created.txt")).toThrow("does not exist");
    expect(running.service.traces.listTraces().length).toBeGreaterThanOrEqual(3);

    await client.close();
  });
});
