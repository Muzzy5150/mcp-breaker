import { ArrowRight, CheckCircle2, CircleAlert, LockKeyhole, Shield } from "lucide-react";

import type { LiveHardeningReport, Stage4HardeningReport, TargetTool } from "@mcp-breaker/shared";

import { SectionHeading } from "./section-heading";

function MetadataPreview({ tools }: { tools: readonly TargetTool[] }) {
  const recommendations = tools.filter((tool) => tool.approvalNormallyRequired);
  return (
    <div className="hardening-list">
      {recommendations.map((tool) => (
        <article key={tool.name}>
          <span className="hardening-icon"><LockKeyhole aria-hidden="true" size={16} /></span>
          <div><code>{tool.name}</code><small>{tool.riskClasses.join(" / ")}</small></div>
          <dl>
            <div><dt>Current</dt><dd>Unrestricted demo tool</dd></div>
            <div><dt>Recommended</dt><dd>REQUIRE_APPROVAL</dd></div>
          </dl>
        </article>
      ))}
    </div>
  );
}

function HardeningResults({ report }: { report: Stage4HardeningReport }) {
  const before = report.baselineAssessment;
  const after = report.postHardeningAssessment;
  const remediated = report.remediationResults.filter((result) => result.status === "REMEDIATED").length;

  return (
    <>
      <div className="hardening-truth-banner">
        <span>Proposed / local simulation</span>
        <strong>Not approved · Not applied to TrueForge</strong>
      </div>

      <div className="hardening-summary" aria-label="Before and after hardening summary">
        <article>
          <p className="eyebrow">Before policy</p>
          <strong>{before.securityAssessment.score}<small>/100</small></strong>
          <span>{before.verifiedFindings.length} verified findings</span>
        </article>
        <ArrowRight className="hardening-summary-arrow" aria-hidden="true" size={22} />
        <article className="hardening-after">
          <p className="eyebrow">After local retest</p>
          <strong>{after.securityAssessment.score}<small>/100</small></strong>
          <span>{after.verifiedFindings.length} verified findings</span>
        </article>
        <article className="hardening-proof-count">
          <p className="eyebrow">Remediation proofs</p>
          <strong>{remediated}<small>/{report.remediationResults.length}</small></strong>
          <span>clean-state replay verified</span>
        </article>
      </div>

      <div className="hardening-subsection">
        <div className="hardening-subheading">
          <div>
            <p className="eyebrow">Current → proposed policy</p>
            <h3>{report.policyDiff.length} effective changes</h3>
          </div>
          <span className="count-chip">Default deny</span>
        </div>
        <div className="hardening-list">
          {report.policyDiff.map((change) => (
            <article key={change.toolName}>
              <span className="hardening-icon"><LockKeyhole aria-hidden="true" size={16} /></span>
              <div>
                <code>{change.toolName}</code>
                <small>{change.riskClasses.join(" / ")}</small>
                <small className="hardening-reason">{change.reason}</small>
                {JSON.stringify(change.currentAllowedContexts) !== JSON.stringify(change.proposedAllowedContexts) ? (
                  <small className="hardening-reason">
                    Contexts: {change.currentAllowedContexts.join("; ") || "none"} → {change.proposedAllowedContexts.join("; ") || "none"}
                  </small>
                ) : null}
              </div>
              <dl>
                <div><dt>Current</dt><dd>{change.currentDisposition}</dd></div>
                <div><dt>Proposed</dt><dd>{change.proposedDisposition}</dd></div>
              </dl>
            </article>
          ))}
        </div>
      </div>

      <div className="hardening-subsection">
        <div className="hardening-subheading">
          <div>
            <p className="eyebrow">Hardened retest</p>
            <h3>Finding-by-finding evidence</h3>
          </div>
          <span className="count-chip count-chip-pass">{remediated} remediated</span>
        </div>
        <div className="remediation-list">
          {report.remediationResults.map((result) => {
            const succeeded = result.status === "REMEDIATED";
            return (
              <details key={result.findingId} className="remediation-card">
                <summary>
                  <span className={succeeded ? "remediation-status remediation-status-pass" : "remediation-status remediation-status-fail"}>
                    {succeeded ? <CheckCircle2 aria-hidden="true" size={15} /> : <CircleAlert aria-hidden="true" size={15} />}
                    {result.status.replaceAll("_", " ")}
                  </span>
                  <code>{result.affectedTool}</code>
                  <span>{result.originalSeverity}</span>
                  <span className="remediation-expand">Inspect evidence</span>
                </summary>
                <div className="remediation-detail">
                  <p>{result.summary}</p>
                  <div className="remediation-context">
                    <div>
                      <span>User intent</span>
                      <p>{result.before.userIntent}</p>
                    </div>
                    <div>
                      <span>Untrusted content</span>
                      <p>{result.before.untrustedContent}</p>
                    </div>
                  </div>
                  <div className="remediation-compare">
                    <div>
                      <p className="eyebrow">Before</p>
                      <strong>Unsafe call executed</strong>
                      <span>State mutation: yes · Replay: reproduced</span>
                      <code>{result.before.executionTraceId}</code>
                    </div>
                    <div>
                      <p className="eyebrow">After</p>
                      <strong>{result.after.policyDecision?.replaceAll("_", " ") ?? "No decision captured"}</strong>
                      <span>Same scenario: yes · Attempt captured: {result.after.relevantToolAttempted ? "yes" : "no"}</span>
                      <span>Executed: {result.after.toolExecuted ? "yes" : "no"} · State mutation: {result.after.stateMutationOccurred ? "yes" : "no"}</span>
                      <code>{result.after.retestTraceId}</code>
                    </div>
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      </div>
    </>
  );
}

function LiveHardeningResults({ report }: { report: LiveHardeningReport }) {
  const before = report.baselineAssessment;
  const after = report.hardenedAssessment;
  const remediated = report.remediationResults.filter((result) => result.status === "REMEDIATED").length;
  return (
    <>
      <div className="hardening-truth-banner hardening-truth-banner-live">
        <span>Live TrueForge enforcement</span>
        <strong>Real approval pauses · test harness denial</strong>
      </div>
      <div className="hardening-summary" aria-label="Live before and after hardening summary">
        <article>
          <p className="eyebrow">Live baseline</p>
          <strong>{before.securityAssessment.score}<small>/100</small></strong>
          <span>{before.verifiedFindings.length} verified findings</span>
        </article>
        <ArrowRight className="hardening-summary-arrow" aria-hidden="true" size={22} />
        <article className="hardening-after">
          <p className="eyebrow">Hardened TrueForge retest</p>
          <strong>{after.securityAssessment.score}<small>/100</small></strong>
          <span>{after.verifiedFindings.length} verified findings</span>
        </article>
        <article className="hardening-proof-count">
          <p className="eyebrow">Live remediation proofs</p>
          <strong>{remediated}<small>/{report.remediationResults.length}</small></strong>
          <span>new-session replay verified</span>
        </article>
      </div>
      <div className="hardening-subsection">
        <div className="hardening-subheading">
          <div><p className="eyebrow">Policy applied to test agent</p><h3>{report.policyDiff.length} effective changes</h3></div>
          <span className="count-chip">{report.requireApprovalForTools.length} approval gates</span>
        </div>
        <div className="hardening-list">
          {report.policyDiff.map((change) => (
            <article key={change.toolName}>
              <span className="hardening-icon"><LockKeyhole aria-hidden="true" size={16} /></span>
              <div><code>{change.toolName}</code><small>{change.reason}</small></div>
              <dl>
                <div><dt>Current</dt><dd>{change.currentDisposition}</dd></div>
                <div><dt>Live retest</dt><dd>{change.proposedDisposition}</dd></div>
              </dl>
            </article>
          ))}
        </div>
      </div>
      <div className="hardening-subsection">
        <div className="hardening-subheading">
          <div><p className="eyebrow">Hardened retest</p><h3>TrueForge approval evidence</h3></div>
          <span className="count-chip count-chip-pass">{remediated} remediated</span>
        </div>
        <div className="remediation-list">
          {report.remediationResults.map((result) => {
            const finding = before.verifiedFindings.find((candidate) => candidate.stableId === result.findingId);
            const succeeded = result.status === "REMEDIATED";
            return (
              <details key={result.findingId} className="remediation-card">
                <summary>
                  <span className={succeeded ? "remediation-status remediation-status-pass" : "remediation-status remediation-status-fail"}>
                    {succeeded ? <CheckCircle2 aria-hidden="true" size={15} /> : <CircleAlert aria-hidden="true" size={15} />}
                    {result.status.replaceAll("_", " ")}
                  </span>
                  <code>{result.affectedTool}</code>
                  <span>{finding?.severity ?? "UNKNOWN"}</span>
                  <span className="remediation-expand">Inspect evidence</span>
                </summary>
                <div className="remediation-detail">
                  <p>{result.summary}</p>
                  <div className="remediation-compare">
                    <div><p className="eyebrow">Retest session</p><code>{result.retestExecutionId}</code></div>
                    <div><p className="eyebrow">Clean replay session</p><code>{result.replayExecutionId}</code></div>
                  </div>
                  <p>{result.approvalEvidenceIds.length} persisted approval-denial evidence records · State mutation prevented: {result.stateMutationPrevented ? "yes" : "no"}</p>
                </div>
              </details>
            );
          })}
        </div>
      </div>
    </>
  );
}

export function Hardening({
  tools,
  report,
}: {
  tools: readonly TargetTool[];
  report?: Stage4HardeningReport | LiveHardeningReport;
}) {
  return (
    <section id="hardening" className="dashboard-section hardening-section" aria-labelledby="hardening-heading">
      <SectionHeading
        eyebrow="Hardening"
        title={report === undefined ? "Baseline Policy Recommendations" : "Before / After Policy Hardening"}
        description={
          report === undefined
            ? "Metadata-based preview only. Recommendations are not autonomously generated and no policy is applied."
            : report.executionMode === "TRUEFORGE_LIVE"
              ? "Live TrueForge approval enforcement against the same natural-language scenarios, backed by persisted events and clean-session replay evidence."
              : "Deterministic local enforcement of the generated proposal against the same scenarios. Every result below is backed by policy-decision and replay evidence."
        }
        headingId="hardening-heading"
        aside={<Shield aria-hidden="true" size={22} />}
      />
      {report === undefined
        ? <MetadataPreview tools={tools} />
        : report.executionMode === "TRUEFORGE_LIVE"
          ? <LiveHardeningResults report={report} />
          : <HardeningResults report={report} />}
    </section>
  );
}
