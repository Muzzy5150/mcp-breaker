import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { DemoToolService, startDemoMcpHttpServer, type RunningDemoMcpHttpServer } from "@mcp-breaker/demo-target";
import { getDeterministicDemoScenario } from "@mcp-breaker/attack-library";

import { executeLiveScenario, runLiveAssessment, type ApprovalDecider } from "./live-assessment.js";
import { runLiveHardening } from "./live-hardening.js";
import { verifyLiveInfrastructure } from "./live-infrastructure.js";
import {
  BASELINE_AGENT_NAME,
  reconcileAgent,
  TRUEFORGE_BASE_URL,
} from "./trueforge-agents.js";
import { OfficialTrueForgeFacade } from "./trueforge-client.js";
import { runTrueForgeDoctor } from "./trueforge-doctor.js";

type LiveCommand = "doctor" | "assessment" | "hardening" | "test";

function commandFromArguments(): LiveCommand {
  const command = process.argv[2] ?? "assessment";
  if (command === "doctor" || command === "assessment" || command === "hardening" || command === "test") {
    return command;
  }
  throw new Error(`Unknown live command ${command}.`);
}

function portError(error: unknown): Error {
  const code = error instanceof Error && "code" in error ? error.code : undefined;
  if (code === "EADDRINUSE") {
    return new Error(
      "Port 18880 is already occupied. The integrated Stage 5 runner must own the demo MCP server; stop the separately launched demo server and retry. No process was terminated.",
      { cause: error },
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}

async function startIntegratedServer(): Promise<RunningDemoMcpHttpServer> {
  try {
    return await startDemoMcpHttpServer({ host: "127.0.0.1", port: 18880, service: new DemoToolService() });
  } catch (error) {
    throw portError(error);
  }
}

function createInteractiveApprovalDecider(): { decider: ApprovalDecider; close(): void } {
  const terminal = createInterface({ input: stdin, output: stdout });
  return {
    decider: async ({ scenario, toolCallId, toolCall }) => {
      stdout.write(
        `\nScenario: ${scenario.id}\nTool: ${toolCall?.toolName ?? "unknown"}\nTool call ID: ${toolCallId}\nArguments: ${JSON.stringify(toolCall?.arguments ?? {})}\nPolicy: TrueForge approval gate\n`,
      );
      const answer = await terminal.question("Decision (ALLOW/DENY; defaults to DENY): ");
      if (answer.trim().toLowerCase() === "allow") {
        return { status: "allow", reason: "HUMAN_ALLOW" };
      }
      const reason = await terminal.question("Denial reason (optional): ");
      return {
        status: "deny",
        reason: reason.trim() === "" ? "HUMAN_DENY" : `HUMAN_DENY: ${reason.trim()}`,
      };
    },
    close: () => terminal.close(),
  };
}

async function writeArtifact(name: string, value: unknown): Promise<string> {
  const directory = resolve(process.cwd(), "artifacts");
  const path = resolve(directory, name);
  await mkdir(directory, { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return path;
}

const command = commandFromArguments();
const client = new OfficialTrueForgeFacade(TRUEFORGE_BASE_URL);
let server: RunningDemoMcpHttpServer | undefined;
let activeSessionId: string | undefined;
const abortController = new AbortController();
const interactive = process.argv.includes("--interactive-approvals") ? createInteractiveApprovalDecider() : undefined;

process.once("SIGINT", () => {
  abortController.abort();
  const cancellation = activeSessionId === undefined ? Promise.resolve() : client.cancelSession(activeSessionId).catch(() => undefined);
  void cancellation.finally(() => {
    process.exitCode = 130;
  });
});

try {
  server = await startIntegratedServer();
  const doctor = await runTrueForgeDoctor(client);
  console.log(JSON.stringify({ command, doctor }, null, 2));
  if (!doctor.ok) {
    throw new Error(doctor.messages.join(" "));
  }
  if (command === "doctor") {
    const baseline = await reconcileAgent(client, BASELINE_AGENT_NAME, []);
    const infrastructureEvidence = await verifyLiveInfrastructure(client);
    const modelAndMcpProbe = await executeLiveScenario({
      client,
      service: server.service,
      agent: baseline.agent,
      scenario: getDeterministicDemoScenario("scenario-indirect-issue-42-safe"),
      runId: "trueforge-doctor-live-probe",
      signal: abortController.signal,
      onSessionCreated: (sessionId) => {
        activeSessionId = sessionId;
      },
      onSessionCompleted: (sessionId) => {
        if (activeSessionId === sessionId) {
          activeSessionId = undefined;
        }
      },
    });
    const readIssueCall = modelAndMcpProbe.toolCalls.find(
      (call) => call.serverName === "mcpbreakerdemo" && call.toolName === "read_issue" && call.executed,
    );
    const liveChecks = {
      terraTurn: modelAndMcpProbe.turnIds.length > 0,
      listIssuesCapability: doctor.toolNames.includes("list_issues"),
      readIssueInvocation: readIssueCall !== undefined,
      safeProbePassed: modelAndMcpProbe.evaluation.status === "PASS",
      sandboxExecution: infrastructureEvidence.sandbox.passed,
      dynamicSubagentSupport: infrastructureEvidence.subagent.attempted,
      sessionRecovery:
        modelAndMcpProbe.recoveryEvidence.getTurnVerified &&
        modelAndMcpProbe.recoveryEvidence.listTurnEventsVerified &&
        modelAndMcpProbe.recoveryEvidence.subscribeResumeVerified,
      cancellation: infrastructureEvidence.cancellation.verified,
    };
    console.log(JSON.stringify({
      liveChecks,
      agentAction: baseline.action,
      agent: { id: baseline.agent.id, name: baseline.agent.name },
      probe: {
        sessionId: modelAndMcpProbe.sessionId,
        turnIds: modelAndMcpProbe.turnIds,
        readIssueToolCallId: readIssueCall?.toolCallId,
      },
      infrastructureEvidence,
    }, null, 2));
    if (!Object.values(liveChecks).every(Boolean)) {
      throw new Error("One or more active TrueForge doctor probes failed.");
    }
    process.exitCode = 0;
  } else {
    const baseline = await reconcileAgent(client, BASELINE_AGENT_NAME, []);
    const infrastructureEvidence = await verifyLiveInfrastructure(client);
    const lifecycle = {
      onSessionCreated: (sessionId: string) => {
        activeSessionId = sessionId;
      },
      onSessionCompleted: (sessionId: string) => {
        if (activeSessionId === sessionId) {
          activeSessionId = undefined;
        }
      },
    };
    if (command === "assessment") {
      const report = await runLiveAssessment({
        client,
        service: server.service,
        agent: baseline.agent,
        infrastructureEvidence,
        ...(interactive === undefined ? {} : { approvalDecider: interactive.decider }),
        signal: abortController.signal,
        ...lifecycle,
      });
      const path = await writeArtifact("live-assessment.json", report);
      console.log(
        JSON.stringify(
          {
            artifact: path,
            agentAction: baseline.action,
            runId: report.runId,
            score: report.securityAssessment.score,
            verifiedFindings: report.verifiedFindings.length,
            counts: report.counts,
            infrastructureEvidence: report.infrastructureEvidence,
          },
          null,
          2,
        ),
      );
    } else {
      const result = await runLiveHardening({
        client,
        service: server.service,
        baselineAgent: baseline.agent,
        infrastructureEvidence,
        ...(interactive === undefined ? {} : { approvalDecider: interactive.decider }),
        signal: abortController.signal,
        ...lifecycle,
      });
      const baselinePath = await writeArtifact("live-assessment.json", result.report.baselineAssessment);
      const hardeningPath = await writeArtifact("live-hardening.json", result.report);
      console.log(
        JSON.stringify(
          {
            baselineArtifact: baselinePath,
            hardeningArtifact: hardeningPath,
            baselineAgentAction: baseline.action,
            hardenedAgentAction: result.agentAction,
            runId: result.report.runId,
            before: {
              score: result.report.baselineAssessment.securityAssessment.score,
              findings: result.report.baselineAssessment.verifiedFindings.length,
            },
            after: {
              score: result.report.hardenedAssessment.securityAssessment.score,
              findings: result.report.hardenedAssessment.verifiedFindings.length,
            },
            remediated: result.report.remediationResults.filter((item) => item.status === "REMEDIATED").length,
            notRemediated: result.report.remediationResults.filter((item) => item.status !== "REMEDIATED").length,
            approvals: result.report.requireApprovalForTools,
            infrastructureEvidence,
          },
          null,
          2,
        ),
      );
    }
  }
} finally {
  interactive?.close();
  await server?.close();
}
