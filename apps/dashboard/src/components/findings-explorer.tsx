import { ArrowDown, CheckCircle2, ChevronDown, RotateCcw, TerminalSquare } from "lucide-react";

import type { DeterministicAssessmentReport, ExecutionStep, Finding } from "@mcp-breaker/shared";

import {
  CATEGORY_LABELS,
  executionForTrace,
  scenarioForFinding,
} from "../lib/dashboard-data";
import { SectionHeading } from "./section-heading";

function EvidenceStep({ step, replay = false }: { step: ExecutionStep; replay?: boolean }) {
  return (
    <article className={`trace-call${replay ? " trace-call-replay" : ""}`}>
      <div className="trace-call-heading">
        <span><TerminalSquare aria-hidden="true" size={15} /> {replay ? "Replayed tool call" : "Unsafe tool call"}</span>
        <code>{step.toolName}</code>
      </div>
      <dl className="trace-fields">
        <div><dt>Arguments</dt><dd><pre>{JSON.stringify(step.arguments, null, 2)}</pre></dd></div>
        <div><dt>Result</dt><dd><pre>{JSON.stringify(step.result ?? step.error ?? "Unavailable", null, 2)}</pre></dd></div>
      </dl>
      {step.stateBefore === undefined || step.stateAfter === undefined ? null : (
        <details className="state-diff">
          <summary>View captured before / after state</summary>
          <div className="state-diff-grid">
            <div><span>Before</span><pre>{JSON.stringify(step.stateBefore, null, 2)}</pre></div>
            <div><span>After</span><pre>{JSON.stringify(step.stateAfter, null, 2)}</pre></div>
          </div>
        </details>
      )}
    </article>
  );
}

function FindingDetail({ report, finding }: { report: DeterministicAssessmentReport; finding: Finding }) {
  const scenario = scenarioForFinding(report, finding);
  const initial = executionForTrace(report, finding.evidence.executionTraceId);
  const replay = executionForTrace(report, finding.evidence.replayExecutionTraceId);
  const initialSteps = initial?.trace.steps.filter((step) => finding.evidence.stepIds.includes(step.id)) ?? [];
  const replaySteps = replay?.trace.steps.filter((step) => finding.evidence.replayStepIds.includes(step.id)) ?? [];
  const title = scenario?.title.replace(/^Unsafe /, "") ?? `${CATEGORY_LABELS[finding.category]} finding`;

  return (
    <details className="finding-card">
      <summary>
        <span className={`severity-badge badge-${finding.severity.toLowerCase()}`}>{finding.severity}</span>
        <span className="finding-summary-copy">
          <strong>{title}</strong>
          <span>{CATEGORY_LABELS[finding.category]} · <code>{finding.targetTool}</code></span>
        </span>
        <span className="reproduced-chip"><RotateCcw aria-hidden="true" size={13} /> {finding.replayResult.status}</span>
        <ChevronDown aria-hidden="true" className="finding-chevron" size={18} />
      </summary>
      <div className="finding-detail">
        <p className="evidence-note">{finding.evidence.stateMutationEvidence.join(" ")}</p>
        <ol className="evidence-flow">
          <li>
            <span className="flow-index">01</span>
            <div><p className="eyebrow">Original user request</p><blockquote>{finding.originalUserIntent}</blockquote></div>
          </li>
          <li><ArrowDown aria-hidden="true" className="flow-arrow" size={17} /></li>
          <li>
            <span className="flow-index">02</span>
            <div><p className="eyebrow">Untrusted content encountered</p><blockquote className="untrusted-copy">{finding.untrustedContent}</blockquote></div>
          </li>
          <li><ArrowDown aria-hidden="true" className="flow-arrow" size={17} /></li>
          <li className="flow-wide">
            <span className="flow-index flow-danger">03</span>
            <div className="flow-grow">
              <p className="eyebrow">Observed runtime evidence</p>
              {initialSteps.length === 0 ? <p className="muted">Referenced tool steps are unavailable.</p> : initialSteps.map((step) => <EvidenceStep key={step.id} step={step} />)}
            </div>
          </li>
        </ol>

        <div className="behavior-compare">
          <div><p className="eyebrow">Expected behavior</p><p>{finding.expectedBehavior.summary}</p></div>
          <div className="actual-behavior"><p className="eyebrow">Actual behavior</p><p>{finding.observedBehavior.summary}</p></div>
        </div>

        <section className="replay-panel" aria-label="Replay evidence">
          <div className="replay-heading">
            <div><p className="section-kicker">Replay evidence</p><h3>Distinct trace, same prohibited action</h3></div>
            <span className="replay-status"><CheckCircle2 aria-hidden="true" size={15} /> {finding.replayResult.status}</span>
          </div>
          <div className="trace-id-grid">
            <div><span>Initial run</span><code>{finding.evidence.executionTraceId}</code></div>
            <div><span>Replay</span><code>{finding.evidence.replayExecutionTraceId}</code></div>
          </div>
          {replaySteps.map((step) => <EvidenceStep key={step.id} replay step={step} />)}
        </section>
      </div>
    </details>
  );
}

export function FindingsExplorer({ report }: { report: DeterministicAssessmentReport }) {
  return (
    <section id="findings" className="dashboard-section" aria-labelledby="findings-heading">
      <SectionHeading
        eyebrow="Verified evidence"
        title="Findings explorer"
        description="Every item below was promoted from a captured candidate only after a clean-state replay matched it."
        aside={<span className="count-chip count-chip-danger">{report.verifiedFindings.length} verified</span>}
      />
      <div className="finding-list" id="findings-heading">
        {report.verifiedFindings.length === 0 ? (
          <div className="empty-panel"><CheckCircle2 aria-hidden="true" size={24} /><h3>No verified findings</h3><p>The assessment completed without replay-verified unsafe behavior.</p></div>
        ) : report.verifiedFindings.map((finding) => <FindingDetail finding={finding} key={finding.stableId} report={report} />)}
      </div>
    </section>
  );
}
