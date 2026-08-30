import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import { DemoToolService, startDemoMcpHttpServer, type RunningDemoMcpHttpServer } from "@mcp-breaker/demo-target";
import type { LiveAssessmentReport, LiveHardeningReport } from "@mcp-breaker/shared";

import { runLiveAssessment, type LiveAssessmentProgressEvent } from "./live-assessment.js";
import { runLiveHardening, type LiveHardeningProgressEvent } from "./live-hardening.js";
import { BASELINE_AGENT_NAME, reconcileAgent, TRUEFORGE_BASE_URL } from "./trueforge-agents.js";
import { OfficialTrueForgeFacade } from "./trueforge-client.js";
import { runTrueForgeDoctor, runTrueForgePlatformReadiness } from "./trueforge-doctor.js";

export const MANAGED_DEMO_TARGET_NAME = "MCP Breaker Demo Target";
export const ZERO_FINDINGS_MESSAGE = "No replay-verified unsafe behavior was observed in this run.";

export type ManagedDemoJobStatus =
  | "IDLE"
  | "PREFLIGHT"
  | "STARTING"
  | "RUNNING"
  | "REPLAYING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "HARDENING"
  | "RETESTING";

export type ManagedDemoAction = "ASSESSMENT" | "HARDENING";
export type ReadinessStatus = "CHECKING" | "READY" | "UNAVAILABLE";

export interface ManagedDemoReadiness {
  overall: ReadinessStatus;
  trueForge: ReadinessStatus;
  terra: ReadinessStatus;
  daytona: ReadinessStatus;
  demoMcp: "MANAGED";
  checkedAt?: string;
  message: string;
}

export interface ManagedDemoMilestones {
  runtimeReady: boolean;
  targetStarted: boolean;
  toolsDiscovered: boolean;
  scenariosStarted: boolean;
  replayVerification: boolean;
  assessmentComplete: boolean;
}

export interface ManagedDemoResultSummary {
  kind: ManagedDemoAction;
  runId: string;
  reportVersion: string;
  baselineScore: number;
  baselineFindings: number;
  hardenedScore?: number;
  hardenedFindings?: number;
  scenariosExecuted: number;
  candidateCount: number;
  inconclusiveCount: number;
  approvalEvents: number;
  blockedActions: number;
  zeroFindingsMessage?: typeof ZERO_FINDINGS_MESSAGE;
  resultMessage?: string;
}

export interface ManagedDemoJobSnapshot {
  jobId?: string;
  action?: ManagedDemoAction;
  status: ManagedDemoJobStatus;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
  currentMessage: string;
  currentScenario?: string;
  scenarioIndex?: number;
  scenarioCount?: number;
  error?: string;
  cleanupPending?: boolean;
  readiness: ManagedDemoReadiness;
  milestones: ManagedDemoMilestones;
  result?: ManagedDemoResultSummary;
}

export type ManagedDemoRunEvent =
  | { type: "RUNTIME_READY"; readiness: ManagedDemoReadiness; message: string }
  | { type: "TARGET_STARTED"; message: string }
  | { type: "TOOLS_DISCOVERED"; message: string }
  | {
      type: "SCENARIO" | "REPLAY";
      stage: "ASSESSMENT" | "BASELINE" | "RETESTING";
      scenarioId: string;
      scenarioIndex: number;
      scenarioCount: number;
      message: string;
    }
  | { type: "HARDENING_POLICY"; message: string }
  | { type: "RETESTING"; message: string };

export interface ManagedDemoRunContext {
  signal: AbortSignal;
  emit(event: ManagedDemoRunEvent): void;
}

export interface ManagedDemoJobServices {
  checkReadiness(): Promise<ManagedDemoReadiness>;
  execute(action: ManagedDemoAction, context: ManagedDemoRunContext): Promise<ManagedDemoResultSummary>;
}

export class ManagedDemoConflictError extends Error {}
export class ManagedDemoNotReadyError extends Error {}

const waitingReadiness: ManagedDemoReadiness = {
  overall: "CHECKING",
  trueForge: "CHECKING",
  terra: "CHECKING",
  daytona: "CHECKING",
  demoMcp: "MANAGED",
  message: "Checking the local TrueForge runtime.",
};

function emptyMilestones(): ManagedDemoMilestones {
  return {
    runtimeReady: false,
    targetStarted: false,
    toolsDiscovered: false,
    scenariosStarted: false,
    replayVerification: false,
    assessmentComplete: false,
  };
}

export function isManagedDemoJobActive(status: ManagedDemoJobStatus): boolean {
  return ["PREFLIGHT", "STARTING", "RUNNING", "REPLAYING", "HARDENING", "RETESTING"].includes(status);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && "code" in error && error.code === "EADDRINUSE") {
    return "Port 18880 is already occupied. Stop the separately launched demo MCP server and try again; MCP Breaker did not terminate that process.";
  }
  return error instanceof Error ? error.message : String(error);
}

export function normalizeManagedDemoError(error: unknown): Error {
  return new Error(errorMessage(error), { cause: error });
}

function cloneSnapshot(snapshot: ManagedDemoJobSnapshot): ManagedDemoJobSnapshot {
  return structuredClone(snapshot);
}

export class ManagedDemoJobManager {
  readonly #services: ManagedDemoJobServices;
  readonly #now: () => string;
  #sequence = 0;
  #controller: AbortController | undefined;
  #run: Promise<void> | undefined;
  #snapshot: ManagedDemoJobSnapshot;
  #readinessCheck: Promise<ManagedDemoReadiness> | undefined;

  constructor(services: ManagedDemoJobServices, now: () => string = () => new Date().toISOString()) {
    this.#services = services;
    this.#now = now;
    this.#snapshot = {
      status: "IDLE",
      updatedAt: now(),
      currentMessage: "Ready to launch the managed disposable demo.",
      readiness: structuredClone(waitingReadiness),
      milestones: emptyMilestones(),
    };
  }

  snapshot(): ManagedDemoJobSnapshot {
    return cloneSnapshot(this.#snapshot);
  }

  async status(options: { ensureReadiness?: boolean; refreshReadiness?: boolean } = {}): Promise<ManagedDemoJobSnapshot> {
    if (
      (options.ensureReadiness === true || options.refreshReadiness === true) &&
      !isManagedDemoJobActive(this.#snapshot.status) &&
      this.#snapshot.cleanupPending !== true
    ) {
      await this.refreshReadiness(options.refreshReadiness === true);
    }
    return this.snapshot();
  }

  async refreshReadiness(force = false): Promise<ManagedDemoReadiness> {
    if (!force && this.#snapshot.readiness.overall !== "CHECKING") {
      return structuredClone(this.#snapshot.readiness);
    }
    if (this.#readinessCheck !== undefined) {
      return this.#readinessCheck;
    }
    this.#snapshot.readiness = structuredClone(waitingReadiness);
    this.#snapshot.updatedAt = this.#now();
    const check = this.#services.checkReadiness()
      .catch((error): ManagedDemoReadiness => ({
        overall: "UNAVAILABLE",
        trueForge: "UNAVAILABLE",
        terra: "UNAVAILABLE",
        daytona: "UNAVAILABLE",
        demoMcp: "MANAGED",
        checkedAt: this.#now(),
        message: `TrueForge readiness is unavailable: ${errorMessage(error)}`,
      }))
      .then((readiness) => {
        if (!isManagedDemoJobActive(this.#snapshot.status)) {
          this.#snapshot.readiness = structuredClone(readiness);
          this.#snapshot.updatedAt = this.#now();
        }
        return structuredClone(readiness);
      })
      .finally(() => {
        this.#readinessCheck = undefined;
      });
    this.#readinessCheck = check;
    return check;
  }

  startAssessment(): ManagedDemoJobSnapshot {
    return this.#start("ASSESSMENT");
  }

  startHardening(): ManagedDemoJobSnapshot {
    if (this.#snapshot.status !== "COMPLETED" || this.#snapshot.result?.kind !== "ASSESSMENT") {
      throw new ManagedDemoNotReadyError("Complete a live demo assessment before starting the hardening retest.");
    }
    return this.#start("HARDENING");
  }

  cancel(): ManagedDemoJobSnapshot {
    if (!isManagedDemoJobActive(this.#snapshot.status) || this.#controller === undefined || this.#run === undefined) {
      throw new ManagedDemoNotReadyError("No managed demo assessment is currently running.");
    }
    const updatedAt = this.#now();
    this.#snapshot = {
      ...this.#snapshot,
      status: "CANCELLED",
      updatedAt,
      completedAt: updatedAt,
      cleanupPending: true,
      currentMessage: "Cancellation requested. Stopping active TrueForge sessions and cleaning up the managed MCP target.",
    };
    this.#controller.abort();
    return this.snapshot();
  }

  #start(action: ManagedDemoAction): ManagedDemoJobSnapshot {
    if (isManagedDemoJobActive(this.#snapshot.status) || this.#run !== undefined) {
      throw new ManagedDemoConflictError("A managed demo assessment is already running.");
    }
    this.#sequence += 1;
    const jobId = `demo-job-${this.#sequence}`;
    const startedAt = this.#now();
    const controller = new AbortController();
    this.#controller = controller;
    this.#snapshot = {
      jobId,
      action,
      status: action === "ASSESSMENT" ? "PREFLIGHT" : "HARDENING",
      startedAt,
      updatedAt: startedAt,
      currentMessage: action === "ASSESSMENT"
        ? "Verifying the local TrueForge runtime before starting the managed target."
        : "Verifying readiness before generating the hardening policy.",
      readiness: structuredClone(waitingReadiness),
      milestones: emptyMilestones(),
    };
    this.#run = Promise.resolve().then(() => this.#execute(jobId, action, controller));
    return this.snapshot();
  }

  async #execute(jobId: string, action: ManagedDemoAction, controller: AbortController): Promise<void> {
    try {
      const result = await this.#services.execute(action, {
        signal: controller.signal,
        emit: (event) => this.#applyEvent(jobId, action, event),
      });
      if (this.#snapshot.jobId !== jobId) {
        return;
      }
      if (controller.signal.aborted) {
        throw new Error("Managed demo assessment cancelled before completion.");
      }
      const completedAt = this.#now();
      const completedSnapshot = cloneSnapshot(this.#snapshot);
      delete completedSnapshot.currentScenario;
      delete completedSnapshot.scenarioIndex;
      delete completedSnapshot.scenarioCount;
      delete completedSnapshot.error;
      delete completedSnapshot.cleanupPending;
      this.#snapshot = {
        ...completedSnapshot,
        status: "COMPLETED",
        completedAt,
        updatedAt: completedAt,
        currentMessage: action === "ASSESSMENT"
          ? "Assessment complete. The dashboard is rendering the generated Stage 5 report."
          : "Hardening retest complete. The dashboard is rendering the live before/after evidence.",
        milestones: { ...this.#snapshot.milestones, replayVerification: true, assessmentComplete: true },
        result,
      };
    } catch (error) {
      if (this.#snapshot.jobId !== jobId) {
        return;
      }
      const completedAt = this.#now();
      const cancelled = controller.signal.aborted;
      const failedSnapshot = cloneSnapshot(this.#snapshot);
      delete failedSnapshot.currentScenario;
      delete failedSnapshot.scenarioIndex;
      delete failedSnapshot.scenarioCount;
      delete failedSnapshot.error;
      delete failedSnapshot.cleanupPending;
      this.#snapshot = {
        ...failedSnapshot,
        status: cancelled ? "CANCELLED" : "FAILED",
        completedAt,
        updatedAt: completedAt,
        currentMessage: cancelled
          ? "Assessment cancelled. Owned sessions and the managed MCP target were cleaned up."
          : "The managed demo assessment could not complete.",
        ...(cancelled ? {} : { error: errorMessage(error) }),
        ...(cancelled ? { cleanupPending: false } : {}),
      };
    } finally {
      if (this.#snapshot.jobId === jobId) {
        this.#controller = undefined;
        this.#run = undefined;
      }
    }
  }

  #applyEvent(jobId: string, action: ManagedDemoAction, event: ManagedDemoRunEvent): void {
    if (this.#snapshot.jobId !== jobId) {
      return;
    }
    const next = { ...this.#snapshot, updatedAt: this.#now() };
    if (event.type === "RUNTIME_READY") {
      next.readiness = structuredClone(event.readiness);
      next.milestones = { ...next.milestones, runtimeReady: true };
      next.status = action === "ASSESSMENT" ? "STARTING" : "HARDENING";
    } else if (event.type === "TARGET_STARTED") {
      next.milestones = { ...next.milestones, targetStarted: true };
      next.status = action === "ASSESSMENT" ? "STARTING" : "HARDENING";
    } else if (event.type === "TOOLS_DISCOVERED") {
      next.milestones = { ...next.milestones, toolsDiscovered: true };
      next.status = action === "ASSESSMENT" ? "RUNNING" : "HARDENING";
    } else if (event.type === "SCENARIO" || event.type === "REPLAY") {
      next.milestones = {
        ...next.milestones,
        scenariosStarted: true,
        replayVerification: next.milestones.replayVerification || event.type === "REPLAY",
      };
      next.status = event.stage === "RETESTING"
        ? "RETESTING"
        : event.type === "REPLAY" && action === "ASSESSMENT"
          ? "REPLAYING"
          : action === "ASSESSMENT" ? "RUNNING" : "HARDENING";
      next.currentScenario = event.scenarioId;
      next.scenarioIndex = event.scenarioIndex + 1;
      next.scenarioCount = event.scenarioCount;
    } else if (event.type === "HARDENING_POLICY") {
      next.status = "HARDENING";
    } else if (event.type === "RETESTING") {
      next.status = "RETESTING";
    }
    next.currentMessage = event.message;
    this.#snapshot = next;
  }
}

function readinessFromPlatform(report: Awaited<ReturnType<typeof runTrueForgePlatformReadiness>>): ManagedDemoReadiness {
  return {
    overall: report.ok ? "READY" : "UNAVAILABLE",
    trueForge: report.checks.server && report.checks.connector && report.checks.connectorAuthorized && report.checks.smokeAgentPreserved
      ? "READY" : "UNAVAILABLE",
    terra: report.checks.model ? "READY" : "UNAVAILABLE",
    daytona: report.checks.sandbox ? "READY" : "UNAVAILABLE",
    demoMcp: "MANAGED",
    checkedAt: report.checkedAt,
    message: report.ok
      ? "TrueForge, GPT-5.6 Terra, and Daytona are ready for the managed local demo."
      : report.messages.join(" "),
  };
}

function progressEvent(
  event: LiveAssessmentProgressEvent,
  stage: "ASSESSMENT" | "BASELINE" | "RETESTING",
): ManagedDemoRunEvent {
  return {
    type: event.phase,
    stage,
    scenarioId: event.scenarioId,
    scenarioIndex: event.scenarioIndex,
    scenarioCount: event.scenarioCount,
    message: event.message,
  };
}

export function summarizeManagedAssessment(report: LiveAssessmentReport): ManagedDemoResultSummary {
  const approvals = report.executions.flatMap((execution) => execution.approvals);
  return {
    kind: "ASSESSMENT",
    runId: report.runId,
    reportVersion: report.reportVersion,
    baselineScore: report.securityAssessment.score,
    baselineFindings: report.verifiedFindings.length,
    scenariosExecuted: report.counts.scenariosExecuted,
    candidateCount: report.counts.candidates,
    inconclusiveCount: report.counts.inconclusive,
    approvalEvents: approvals.length,
    blockedActions: approvals.filter((approval) => approval.status === "deny").length,
    ...(report.verifiedFindings.length === 0 ? { zeroFindingsMessage: ZERO_FINDINGS_MESSAGE } : {}),
  };
}

export function summarizeManagedHardening(report: LiveHardeningReport): ManagedDemoResultSummary {
  const approvals = [report.baselineAssessment, report.hardenedAssessment]
    .flatMap((assessment) => assessment.executions)
    .flatMap((execution) => execution.approvals);
  return {
    kind: "HARDENING",
    runId: report.runId,
    reportVersion: report.reportVersion,
    baselineScore: report.baselineAssessment.securityAssessment.score,
    baselineFindings: report.baselineAssessment.verifiedFindings.length,
    hardenedScore: report.hardenedAssessment.securityAssessment.score,
    hardenedFindings: report.hardenedAssessment.verifiedFindings.length,
    scenariosExecuted: report.hardenedAssessment.counts.scenariosExecuted,
    candidateCount: report.hardenedAssessment.counts.candidates,
    inconclusiveCount: report.hardenedAssessment.counts.inconclusive,
    approvalEvents: approvals.length,
    blockedActions: approvals.filter((approval) => approval.status === "deny").length,
    ...(report.baselineAssessment.verifiedFindings.length === 0 && report.hardenedAssessment.verifiedFindings.length === 0
      ? { zeroFindingsMessage: ZERO_FINDINGS_MESSAGE }
      : report.hardenedAssessment.verifiedFindings.length === 0
        ? { resultMessage: `The hardened retest completed with 0 replay-verified findings after ${report.baselineAssessment.verifiedFindings.length} baseline finding${report.baselineAssessment.verifiedFindings.length === 1 ? "" : "s"}.` }
        : {}),
  };
}

export function defaultManagedDemoArtifactDirectory(cwd = process.cwd()): string {
  return basename(cwd) === "dashboard" && basename(dirname(cwd)) === "apps"
    ? resolve(cwd, "../..", "artifacts")
    : resolve(cwd, "artifacts");
}

export interface ManagedArtifactOperations {
  ensureDirectory(path: string): Promise<void>;
  write(path: string, content: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
}

const defaultArtifactOperations: ManagedArtifactOperations = {
  ensureDirectory: async (path) => { await mkdir(path, { recursive: true }); },
  write: async (path, content) => { await writeFile(path, content, { encoding: "utf8", mode: 0o600 }); },
  rename,
  remove: async (path) => { await rm(path, { force: true }); },
};

interface StagedArtifact { temporary: string; destination: string }

async function stageArtifact(
  directory: string,
  name: string,
  value: unknown,
  operations: ManagedArtifactOperations,
): Promise<StagedArtifact> {
  await operations.ensureDirectory(directory);
  const destination = resolve(directory, name);
  const temporary = resolve(directory, `.${name}.${process.pid}.tmp`);
  await operations.write(temporary, `${JSON.stringify(value, null, 2)}\n`);
  return { temporary, destination };
}

async function writeArtifact(directory: string, name: string, value: unknown): Promise<void> {
  const staged = await stageArtifact(directory, name, value, defaultArtifactOperations);
  try {
    await defaultArtifactOperations.rename(staged.temporary, staged.destination);
  } catch (error) {
    await defaultArtifactOperations.remove(staged.temporary);
    throw error;
  }
}

export async function publishManagedHardeningArtifacts(
  directory: string,
  report: LiveHardeningReport,
  operations: ManagedArtifactOperations = defaultArtifactOperations,
): Promise<{ assessmentUpdated: boolean }> {
  const assessment = await stageArtifact(directory, "live-assessment.json", report.baselineAssessment, operations);
  let hardening: StagedArtifact;
  try {
    hardening = await stageArtifact(directory, "live-hardening.json", report, operations);
  } catch (error) {
    await operations.remove(assessment.temporary);
    throw error;
  }
  try {
    await operations.rename(hardening.temporary, hardening.destination);
  } catch (error) {
    await Promise.allSettled([
      operations.remove(hardening.temporary),
      operations.remove(assessment.temporary),
    ]);
    throw error;
  }
  try {
    await operations.rename(assessment.temporary, assessment.destination);
    return { assessmentUpdated: true };
  } catch {
    await operations.remove(assessment.temporary);
    return { assessmentUpdated: false };
  }
}

export function createManagedDemoJobManager(options: { artifactDirectory?: string } = {}): ManagedDemoJobManager {
  const artifactDirectory = options.artifactDirectory ?? defaultManagedDemoArtifactDirectory();
  const services: ManagedDemoJobServices = {
    checkReadiness: async () => {
      const client = new OfficialTrueForgeFacade(TRUEFORGE_BASE_URL);
      return readinessFromPlatform(await runTrueForgePlatformReadiness(client));
    },
    execute: async (action, context) => {
      const client = new OfficialTrueForgeFacade(TRUEFORGE_BASE_URL);
      let server: RunningDemoMcpHttpServer | undefined;
      const activeSessions = new Set<string>();
      const cancelActiveSessions = () => {
        void Promise.allSettled([...activeSessions].map((sessionId) => client.cancelSession(sessionId)));
      };
      context.signal.addEventListener("abort", cancelActiveSessions, { once: true });
      try {
        const platform = await runTrueForgePlatformReadiness(client, context.signal);
        context.signal.throwIfAborted();
        const readiness = readinessFromPlatform(platform);
        if (!platform.ok) {
          throw new Error(readiness.message);
        }
        context.emit({ type: "RUNTIME_READY", readiness, message: "TrueForge, GPT-5.6 Terra, and Daytona are ready." });
        context.signal.throwIfAborted();
        try {
          server = await startDemoMcpHttpServer({ host: "127.0.0.1", port: 18880, service: new DemoToolService() });
        } catch (error) {
          throw normalizeManagedDemoError(error);
        }
        context.emit({ type: "TARGET_STARTED", message: "Disposable MCP target started on managed loopback port 18880." });
        const doctor = await runTrueForgeDoctor(client, { readiness: platform, signal: context.signal });
        context.signal.throwIfAborted();
        if (!doctor.ok) {
          throw new Error(doctor.messages.join(" "));
        }
        context.emit({ type: "TOOLS_DISCOVERED", message: `TrueForge discovered and validated ${doctor.toolNames.length} demo tools.` });
        const baseline = await reconcileAgent(client, BASELINE_AGENT_NAME, [], context.signal);
        context.signal.throwIfAborted();
        const lifecycle = {
          onSessionCreated: (sessionId: string) => activeSessions.add(sessionId),
          onSessionCompleted: (sessionId: string) => activeSessions.delete(sessionId),
        };
        if (action === "ASSESSMENT") {
          const report = await runLiveAssessment({
            client,
            service: server.service,
            agent: baseline.agent,
            signal: context.signal,
            ...lifecycle,
            onProgress: (event) => context.emit(progressEvent(event, "ASSESSMENT")),
          });
          await writeArtifact(artifactDirectory, "live-assessment.json", report);
          return summarizeManagedAssessment(report);
        }
        const result = await runLiveHardening({
          client,
          service: server.service,
          baselineAgent: baseline.agent,
          signal: context.signal,
          ...lifecycle,
          onProgress: (event: LiveHardeningProgressEvent) => {
            if (event.phase === "POLICY") {
              context.emit({ type: "HARDENING_POLICY", message: event.message });
            } else if (event.phase === "RETESTING" && event.assessment === undefined) {
              context.emit({ type: "RETESTING", message: event.message });
            } else if (event.assessment !== undefined) {
              context.emit(progressEvent(event.assessment, event.phase === "RETESTING" ? "RETESTING" : "BASELINE"));
            }
          },
        });
        await publishManagedHardeningArtifacts(artifactDirectory, result.report);
        return summarizeManagedHardening(result.report);
      } finally {
        context.signal.removeEventListener("abort", cancelActiveSessions);
        if (context.signal.aborted) {
          await Promise.allSettled([...activeSessions].map((sessionId) => client.cancelSession(sessionId)));
        }
        await server?.close();
      }
    },
  };
  return new ManagedDemoJobManager(services);
}
