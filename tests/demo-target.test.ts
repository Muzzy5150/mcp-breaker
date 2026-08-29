import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TraceRecorder } from "@mcp-breaker/breaker-core";
import {
  DEMO_TOOL_METADATA,
  DemoStateStore,
  DemoToolService,
  createBaselineDemoState,
} from "@mcp-breaker/demo-target";
import { describe, expect, it } from "vitest";

import { DeterministicClock, DeterministicIds } from "./helpers.js";

function createService() {
  const clock = new DeterministicClock();
  return new DemoToolService(
    new DemoStateStore(() => clock.now()),
    new TraceRecorder(clock, new DeterministicIds()),
  );
}

const context = {
  sessionId: "session-test",
  testId: "demo-target-test",
  provenance: "TEST_FIXTURE" as const,
};

describe("disposable demo state", () => {
  it("resets every entity and counter to the deterministic baseline", async () => {
    const service = createService();
    await service.invokeStandalone("write_file", { path: "new-file.txt", content: "changed" }, context);
    await service.invokeStandalone("merge_pull_request", { pullRequestNumber: 19 }, context);
    await service.invokeStandalone("send_message", { channel: "#demo", body: "hello" }, context);

    await service.invokeStandalone("reset_demo_state", { confirmation: "RESET_DEMO_STATE" }, context);

    expect(service.state.snapshot()).toEqual(createBaselineDemoState());
  });

  it("reads issue and pull-request fixture content without changing state", async () => {
    const service = createService();
    const before = service.state.snapshot();

    const issueResult = await service.invokeStandalone("read_issue", { issueNumber: 42 }, context);
    const pullRequestResult = await service.invokeStandalone(
      "read_pull_request",
      { pullRequestNumber: 19 },
      context,
    );

    expect(JSON.stringify(issueResult.result)).toContain("merge PR #19");
    expect(JSON.stringify(pullRequestResult.result)).toContain("#releases");
    expect(service.state.snapshot()).toEqual(before);
  });

  it("creates and overwrites only virtual in-memory files", async () => {
    const service = createService();

    const created = await service.invokeStandalone(
      "write_file",
      { path: "notes/review.txt", content: "first" },
      context,
    );
    const overwritten = await service.invokeStandalone(
      "write_file",
      { path: "notes/review.txt", content: "second" },
      context,
    );

    expect(created.result).toMatchObject({ created: true });
    expect(overwritten.result).toMatchObject({ created: false });
    expect(service.state.readFile("notes/review.txt").content).toBe("second");
  });

  it("stores prototype-shaped paths as ordinary virtual files", async () => {
    const service = createService();
    const created = await service.invokeStandalone(
      "write_file",
      { path: "__proto__", content: "virtual only" },
      context,
    );

    expect(created.result).toMatchObject({ created: true });
    expect(service.state.readFile("__proto__").content).toBe("virtual only");
    expect(service.state.listFiles().map((file) => file.path)).toContain("__proto__");

    await service.invokeStandalone("delete_file", { path: "__proto__" }, context);
    expect(() => service.state.readFile("__proto__")).toThrow("does not exist");
  });

  it("executes destructive and communication tools only against demo state", async () => {
    const service = createService();

    await service.invokeStandalone("delete_file", { path: "tmp-report.csv" }, context);
    await service.invokeStandalone("merge_pull_request", { pullRequestNumber: 19 }, context);
    await service.invokeStandalone("send_message", { channel: "#releases", body: "demo only" }, context);

    expect(() => service.state.readFile("tmp-report.csv")).toThrow("does not exist");
    expect(service.state.readPullRequest(19).status).toBe("MERGED");
    expect(service.state.snapshot().messages).toHaveLength(1);
  });

  it("creates deterministic pull-request records", async () => {
    const service = createService();
    const result = await service.invokeStandalone(
      "create_pull_request",
      {
        title: "Demo change",
        description: "In-memory only",
        sourceBranch: "demo/change",
        targetBranch: "main",
      },
      context,
    );

    expect(result.result).toMatchObject({ pullRequest: { number: 20, status: "OPEN" } });
    expect(service.state.snapshot().nextPullRequestNumber).toBe(21);
  });

  it("cannot modify a host file through absolute or traversal paths", async () => {
    const service = createService();
    const fixtureDirectory = await mkdtemp(join(tmpdir(), "mcp-breaker-safety-"));
    const hostFile = join(fixtureDirectory, "outside.txt");
    try {
      await writeFile(hostFile, "HOST_SENTINEL", "utf8");

      await expect(
        service.invokeStandalone("write_file", { path: hostFile, content: "modified" }, context),
      ).rejects.toThrow("relative virtual demo path");
      await expect(
        service.invokeStandalone("write_file", { path: "../outside.txt", content: "modified" }, context),
      ).rejects.toThrow();

      expect(await readFile(hostFile, "utf8")).toBe("HOST_SENTINEL");
      expect(service.state.listFiles().some((file) => file.path.includes("outside.txt"))).toBe(false);
    } finally {
      await rm(fixtureDirectory, { recursive: true, force: true });
    }
  });
});

describe("tool risk metadata", () => {
  it("covers every demo tool exactly once and gates every state-changing tool", () => {
    const names = DEMO_TOOL_METADATA.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toHaveLength(11);

    for (const tool of DEMO_TOOL_METADATA) {
      const readOnly = tool.riskClasses.length === 1 && tool.riskClasses[0] === "READ_ONLY";
      expect(tool.approvalNormallyRequired).toBe(!readOnly);
      expect(tool.expectedAllowedContexts.length).toBeGreaterThan(0);
    }
  });

  it("classifies the highest-risk tools explicitly", () => {
    const merge = DEMO_TOOL_METADATA.find((tool) => tool.name === "merge_pull_request");
    const message = DEMO_TOOL_METADATA.find((tool) => tool.name === "send_message");
    expect(merge?.riskClasses).toEqual(["WRITE", "DESTRUCTIVE", "PRIVILEGED"]);
    expect(message?.riskClasses).toContain("EXTERNAL_COMMUNICATION");
  });
});
