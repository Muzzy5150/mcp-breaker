import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  ManagedDemoConflictError,
  ManagedDemoJobManager,
  ManagedDemoNotReadyError,
  normalizeManagedDemoError,
  publishManagedHardeningArtifacts,
  summarizeManagedHardening,
  ZERO_FINDINGS_MESSAGE,
  type ManagedArtifactOperations,
  type ManagedDemoJobServices,
  type ManagedDemoJobSnapshot,
  type ManagedDemoReadiness,
  type ManagedDemoResultSummary,
} from "@mcp-breaker/evaluation";
import type { LiveHardeningReport } from "@mcp-breaker/shared";

import { DemoAssessmentControls } from "../apps/dashboard/src/components/demo-assessment-controls.js";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const ready: ManagedDemoReadiness = {
  overall: "READY",
  trueForge: "READY",
  terra: "READY",
  daytona: "READY",
  demoMcp: "MANAGED",
  checkedAt: "2026-08-29T23:30:00.000Z",
  message: "Ready.",
};

const zeroFindingResult: ManagedDemoResultSummary = {
  kind: "ASSESSMENT",
  runId: "trueforge-assessment-test",
  reportVersion: "3.0.0",
  baselineScore: 100,
  baselineFindings: 0,
  scenariosExecuted: 8,
  candidateCount: 2,
  inconclusiveCount: 4,
  approvalEvents: 0,
  blockedActions: 0,
  zeroFindingsMessage: ZERO_FINDINGS_MESSAGE,
};

function services(
  execute: ManagedDemoJobServices["execute"],
  readiness: ManagedDemoReadiness = ready,
): ManagedDemoJobServices {
  return { checkReadiness: () => Promise.resolve(readiness), execute };
}

async function waitForStatus(manager: ManagedDemoJobManager, status: ManagedDemoJobSnapshot["status"]) {
  await vi.waitFor(() => expect(manager.snapshot().status).toBe(status));
  return manager.snapshot();
}

describe("Stage 5.5 managed website job", () => {
  it("starts one assessment, exposes truthful status, rejects a duplicate, and completes with the Stage 5 result", async () => {
    let finish: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const manager = new ManagedDemoJobManager(services(async (_action, context) => {
      context.emit({ type: "RUNTIME_READY", readiness: ready, message: "Runtime ready." });
      context.emit({ type: "TARGET_STARTED", message: "Target started." });
      context.emit({ type: "TOOLS_DISCOVERED", message: "11 tools discovered." });
      context.emit({
        type: "SCENARIO",
        stage: "ASSESSMENT",
        scenarioId: "scenario-safe",
        scenarioIndex: 0,
        scenarioCount: 8,
        message: "Running scenario 1 of 8.",
      });
      await gate;
      return zeroFindingResult;
    }));

    expect(manager.startAssessment().status).toBe("PREFLIGHT");
    expect(() => manager.startAssessment()).toThrow(ManagedDemoConflictError);
    const running = await waitForStatus(manager, "RUNNING");
    expect(running.currentScenario).toBe("scenario-safe");
    expect(running.milestones.toolsDiscovered).toBe(true);
    finish?.();
    const completed = await waitForStatus(manager, "COMPLETED");
    expect(completed.result).toEqual(zeroFindingResult);
    expect(completed.result?.zeroFindingsMessage).toBe(ZERO_FINDINGS_MESSAGE);
  });

  it("reports failures and preserves the clean port-in-use message", async () => {
    const portError = Object.assign(new Error("bind failed"), { code: "EADDRINUSE" });
    expect(normalizeManagedDemoError(portError).message).toContain("Port 18880 is already occupied");
    const manager = new ManagedDemoJobManager(services(() => Promise.reject(normalizeManagedDemoError(portError))));
    manager.startAssessment();
    const failed = await waitForStatus(manager, "FAILED");
    expect(failed.error).toContain("did not terminate that process");
  });

  it("marks cancellation promptly while cleanup continues, then confirms cleanup", async () => {
    let finish: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const manager = new ManagedDemoJobManager(services(async (_action, context) => {
      context.emit({ type: "RUNTIME_READY", readiness: ready, message: "Runtime ready." });
      await gate;
      return zeroFindingResult;
    }));
    expect(() => manager.cancel()).toThrow(ManagedDemoNotReadyError);
    manager.startAssessment();
    await waitForStatus(manager, "STARTING");
    const cancelled = manager.cancel();
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cleanupPending).toBe(true);
    expect(() => manager.startAssessment()).toThrow(ManagedDemoConflictError);
    finish?.();
    await vi.waitFor(() => expect(manager.snapshot().cleanupPending).toBe(false));
    expect(manager.snapshot().currentMessage).toContain("cleaned up");
  });

  it("starts hardening only after completion and exposes the retest state", async () => {
    let calls = 0;
    const manager = new ManagedDemoJobManager(services((action, context) => {
      calls += 1;
      if (action === "HARDENING") {
        context.emit({ type: "HARDENING_POLICY", message: "Policy applied." });
        context.emit({ type: "RETESTING", message: "Retesting same scenarios." });
        return Promise.resolve({ ...zeroFindingResult, kind: "HARDENING", reportVersion: "3.1.0", hardenedScore: 100, hardenedFindings: 0 });
      }
      return Promise.resolve(zeroFindingResult);
    }));
    expect(() => manager.startHardening()).toThrow(ManagedDemoNotReadyError);
    manager.startAssessment();
    await waitForStatus(manager, "COMPLETED");
    expect(manager.startHardening().status).toBe("HARDENING");
    await waitForStatus(manager, "COMPLETED");
    expect(manager.snapshot().result?.kind).toBe("HARDENING");
    expect(calls).toBe(2);
  });

  it("disables launch and explains an unavailable readiness state", async () => {
    const unavailable: ManagedDemoReadiness = {
      overall: "UNAVAILABLE",
      trueForge: "UNAVAILABLE",
      terra: "UNAVAILABLE",
      daytona: "UNAVAILABLE",
      demoMcp: "MANAGED",
      message: "Start TrueForge on localhost:8790.",
    };
    const manager = new ManagedDemoJobManager(services(() => Promise.resolve(zeroFindingResult), unavailable));
    const snapshot = await manager.status({ ensureReadiness: true });
    const html = renderToStaticMarkup(<DemoAssessmentControls initialState={snapshot} />);
    expect(snapshot.readiness.overall).toBe("UNAVAILABLE");
    expect(html).toContain("Launch unavailable:");
    expect(html).toContain("Start TrueForge on localhost:8790.");
    expect(html).toMatch(/disabled=""[^>]*>.*Launch Demo Assessment/s);
  });

  it("renders coarse evidence-backed milestones and never invents a progress percentage", () => {
    const snapshot: ManagedDemoJobSnapshot = {
      jobId: "demo-job-1",
      action: "ASSESSMENT",
      status: "RUNNING",
      startedAt: "2026-08-29T23:30:00.000Z",
      updatedAt: "2026-08-29T23:30:01.000Z",
      currentMessage: "Running scenario 1 of 8.",
      currentScenario: "scenario-safe",
      scenarioIndex: 1,
      scenarioCount: 8,
      readiness: ready,
      milestones: {
        runtimeReady: true,
        targetStarted: true,
        toolsDiscovered: true,
        scenariosStarted: true,
        replayVerification: false,
        assessmentComplete: false,
      },
    };
    const html = renderToStaticMarkup(<DemoAssessmentControls initialState={snapshot} />);
    expect(html).toContain("job-progress-complete");
    expect(html).toContain("job-progress-current");
    expect(html).toContain("job-progress-pending");
    expect(html).not.toMatch(/\b\d{1,3}%\b/);
    expect(html).not.toContain("chain-of-thought");
  });

  it("qualifies a clean hardened retest when the same run observed baseline findings", () => {
    const assessment = {
      securityAssessment: { score: 70 },
      verifiedFindings: [{ stableId: "finding-1" }, { stableId: "finding-2" }],
      executions: [],
      counts: { scenariosExecuted: 8, candidates: 3, inconclusive: 0 },
    };
    const report = {
      runId: "hardening-run",
      reportVersion: "3.1.0",
      baselineAssessment: assessment,
      hardenedAssessment: {
        securityAssessment: { score: 100 },
        verifiedFindings: [],
        executions: [],
        counts: { scenariosExecuted: 8, candidates: 0, inconclusive: 1 },
      },
    } as unknown as LiveHardeningReport;
    const summary = summarizeManagedHardening(report);
    expect(summary.zeroFindingsMessage).toBeUndefined();
    expect(summary.resultMessage).toBe("The hardened retest completed with 0 replay-verified findings after 2 baseline findings.");
  });

  it("commits the self-contained hardening artifact before its derived assessment", async () => {
    const operations: string[] = [];
    const fakeOperations: ManagedArtifactOperations = {
      ensureDirectory: (path) => { operations.push(`mkdir:${path}`); return Promise.resolve(); },
      write: (path) => { operations.push(`write:${path}`); return Promise.resolve(); },
      rename: (from, to) => {
        operations.push(`rename:${from}->${to}`);
        return to.endsWith("live-assessment.json") ? Promise.reject(new Error("derived write failed")) : Promise.resolve();
      },
      remove: (path) => { operations.push(`remove:${path}`); return Promise.resolve(); },
    };
    const report = {
      runId: "hardening-run",
      reportVersion: "3.1.0",
      baselineAssessment: { runId: "baseline" },
    } as unknown as LiveHardeningReport;
    const result = await publishManagedHardeningArtifacts("/tmp/artifacts", report, fakeOperations);
    const renames = operations.filter((operation) => operation.startsWith("rename:"));
    expect(result.assessmentUpdated).toBe(false);
    expect(renames[0]).toContain("live-hardening.json");
    expect(renames[1]).toContain("live-assessment.json");
  });
});
