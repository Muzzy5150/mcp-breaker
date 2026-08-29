"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Circle, LoaderCircle, Play, RotateCcw, ShieldCheck, Square } from "lucide-react";

import type { ManagedDemoJobSnapshot, ManagedDemoJobStatus } from "@mcp-breaker/evaluation";

const endpoints = {
  assessment: "/api/demo-assessment/start",
  cancel: "/api/demo-assessment/cancel",
  hardening: "/api/demo-assessment/harden",
  status: "/api/demo-assessment/status",
} as const;

const activeStatuses = new Set<ManagedDemoJobStatus>(["PREFLIGHT", "STARTING", "RUNNING", "REPLAYING", "HARDENING", "RETESTING"]);

function readinessClass(status: string): string {
  return status === "READY" || status === "MANAGED" ? "readiness-ready" : status === "UNAVAILABLE" ? "readiness-error" : "readiness-checking";
}

function ProgressIcon({ state }: { state: "complete" | "current" | "pending" }) {
  if (state === "complete") {
    return <Check aria-hidden="true" size={13} />;
  }
  if (state === "current") {
    return <LoaderCircle aria-hidden="true" size={13} className="job-spinner" />;
  }
  return <Circle aria-hidden="true" size={11} />;
}

function progressState(complete: boolean, current: boolean): "complete" | "current" | "pending" {
  return complete ? "complete" : current ? "current" : "pending";
}

export function DemoAssessmentControls({ initialState }: { initialState: ManagedDemoJobSnapshot }) {
  const router = useRouter();
  const [job, setJob] = useState(initialState);
  const [requestPending, setRequestPending] = useState(false);
  const completedJob = useRef(initialState.status === "COMPLETED" ? initialState.jobId : undefined);
  const active = activeStatuses.has(job.status);

  useEffect(() => {
    let disposed = false;
    const load = async (refreshReadiness = false) => {
      try {
        const response = await fetch(`${endpoints.status}${refreshReadiness ? "?refresh=1" : ""}`, { cache: "no-store" });
        const snapshot = await response.json() as ManagedDemoJobSnapshot;
        if (disposed) {
          return;
        }
        setJob(snapshot);
        if (snapshot.status === "COMPLETED" && snapshot.jobId !== undefined && completedJob.current !== snapshot.jobId) {
          completedJob.current = snapshot.jobId;
          router.refresh();
        }
      } catch {
        if (!disposed) {
          setJob((current) => ({
            ...current,
            readiness: {
              ...current.readiness,
              overall: "UNAVAILABLE",
              trueForge: "UNAVAILABLE",
              terra: "UNAVAILABLE",
              daytona: "UNAVAILABLE",
              message: "The local demo status endpoint is unavailable. Confirm npm run demo:ui is still running.",
            },
          }));
        }
      }
    };
    void load(!active);
    const timer = active ? window.setInterval(() => void load(), 1_000) : undefined;
    return () => {
      disposed = true;
      if (timer !== undefined) {
        window.clearInterval(timer);
      }
    };
  }, [active, router]);

  async function mutate(endpoint: string) {
    setRequestPending(true);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" } });
      const payload = await response.json() as ManagedDemoJobSnapshot | { error?: string; job?: ManagedDemoJobSnapshot };
      if ("job" in payload && payload.job !== undefined) {
        setJob(payload.job);
      } else if (response.ok) {
        setJob(payload as ManagedDemoJobSnapshot);
      } else {
        const message = "error" in payload && typeof payload.error === "string" ? payload.error : "The managed demo request failed.";
        setJob((current) => ({ ...current, error: message, currentMessage: message }));
      }
    } catch {
      setJob((current) => ({
        ...current,
        error: "The local demo API is unavailable. Confirm npm run demo:ui is still running.",
      }));
    } finally {
      setRequestPending(false);
    }
  }

  const terminal = job.status === "COMPLETED" || job.status === "FAILED" || job.status === "CANCELLED";
  const canLaunch = !active && !requestPending && job.readiness.overall === "READY";
  const scenariosComplete = job.milestones.assessmentComplete || job.milestones.replayVerification;
  const replayCurrent = job.status === "REPLAYING";
  const progress = [
    { label: "Runtime ready", state: progressState(job.milestones.runtimeReady, active && job.status === "PREFLIGHT") },
    { label: "MCP target started", state: progressState(job.milestones.targetStarted, active && job.status === "STARTING") },
    { label: "Tools discovered", state: progressState(job.milestones.toolsDiscovered, active && job.milestones.targetStarted && !job.milestones.toolsDiscovered) },
    { label: job.action === "HARDENING" ? "Running policy baseline" : "Running predefined scenarios", state: progressState(scenariosComplete, active && job.milestones.scenariosStarted && !scenariosComplete && !replayCurrent) },
    { label: job.action === "HARDENING" ? "Retesting same scenarios" : "Replay verification", state: progressState(job.milestones.assessmentComplete, active && (replayCurrent || job.status === "RETESTING")) },
    { label: "Assessment complete", state: progressState(job.milestones.assessmentComplete, false) },
  ];
  const readinessItems = [
    { label: "TrueForge", status: job.readiness.trueForge },
    { label: "Terra", status: job.readiness.terra },
    { label: "Daytona", status: job.readiness.daytona },
    { label: "Demo MCP", status: job.readiness.demoMcp },
  ];

  return (
    <section className="demo-control-panel" aria-labelledby="demo-control-heading">
      <div className="demo-control-main">
        <div className="demo-control-copy">
          <p className="section-kicker"><ShieldCheck aria-hidden="true" size={15} /> Managed website demo</p>
          <h2 id="demo-control-heading">Launch Demo Assessment</h2>
          <p>Run the predefined security suite against MCP Breaker&apos;s disposable local MCP agent using TrueForge and GPT-5.6 Terra.</p>
          <dl className="demo-target-grid">
            <div><dt>Target</dt><dd>MCP Breaker Demo Target</dd></div>
            <div><dt>Harness</dt><dd>TrueForge</dd></div>
            <div><dt>Model</dt><dd>GPT-5.6 Terra</dd></div>
            <div><dt>Environment</dt><dd>Disposable local state</dd></div>
          </dl>
        </div>

        <div className="demo-action-column">
          <div className="demo-actions">
            <button
              type="button"
              className="demo-primary-button"
              disabled={!canLaunch}
              onClick={() => void mutate(endpoints.assessment)}
            >
              {active ? <LoaderCircle aria-hidden="true" size={15} className="job-spinner" /> : terminal ? <RotateCcw aria-hidden="true" size={15} /> : <Play aria-hidden="true" size={15} />}
              {active ? "Assessment Running" : terminal ? "Run Again" : "Launch Demo Assessment"}
            </button>
            {active ? (
              <button type="button" className="demo-stop-button" disabled={requestPending} onClick={() => void mutate(endpoints.cancel)}>
                <Square aria-hidden="true" size={13} /> Stop Assessment
              </button>
            ) : null}
            {job.status === "COMPLETED" && job.result?.kind === "ASSESSMENT" ? (
              <button type="button" className="demo-secondary-button" disabled={requestPending} onClick={() => void mutate(endpoints.hardening)}>
                <ShieldCheck aria-hidden="true" size={15} /> Retest With Hardening
              </button>
            ) : null}
          </div>
          <div className="readiness-grid" aria-label="Managed demo readiness">
            {readinessItems.map(({ label, status }) => (
              <div key={label}><span>{label}</span><strong className={readinessClass(status)}>{status}</strong></div>
            ))}
          </div>
        </div>
      </div>

      <div className="job-status-panel" aria-live="polite">
        <div className="job-status-heading">
          <div><span className={active ? "management-live-dot" : "job-status-dot"} /><strong>{job.action === "HARDENING" ? "HARDENING POLICY → RETESTING SAME SCENARIOS" : "TRUEFORGE LIVE ASSESSMENT"}</strong></div>
          <span className={`job-state job-state-${job.status.toLowerCase()}`}>{job.status.replaceAll("_", " ")}</span>
        </div>
        <p>{job.currentMessage}</p>
        {job.currentScenario !== undefined ? <code>{job.currentScenario}{job.scenarioIndex !== undefined && job.scenarioCount !== undefined ? ` · ${job.scenarioIndex}/${job.scenarioCount}` : ""}</code> : null}
        <ol className="job-progress">
          {progress.map((item) => (
            <li key={item.label} className={`job-progress-${item.state}`}>
              <ProgressIcon state={item.state} /><span>{item.label}</span>
            </li>
          ))}
        </ol>
        {job.error !== undefined ? <p className="job-error"><strong>Action required:</strong> {job.error}</p> : null}
        {job.readiness.overall === "UNAVAILABLE" && !active ? <p className="job-error"><strong>Launch unavailable:</strong> {job.readiness.message}</p> : null}
        {job.result !== undefined ? (
          <div className="job-result-summary">
            {job.result.zeroFindingsMessage !== undefined ? <strong>{job.result.zeroFindingsMessage}</strong> : null}
            <dl>
              <div><dt>Scenarios</dt><dd>{job.result.scenariosExecuted}</dd></div>
              <div><dt>Candidates</dt><dd>{job.result.candidateCount}</dd></div>
              <div><dt>Inconclusive</dt><dd>{job.result.inconclusiveCount}</dd></div>
              <div><dt>Approval events</dt><dd>{job.result.approvalEvents}</dd></div>
              <div><dt>Blocked actions</dt><dd>{job.result.blockedActions}</dd></div>
            </dl>
            <span>This run is evidence, not a claim that the MCP server is secure.</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
