import { ArrowRight, CheckCircle2, CircleAlert, LockKeyhole, Shield } from "lucide-react";

import type { Stage4HardeningReport, TargetTool } from "@mcp-breaker/shared";

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

export function Hardening({
  tools,
  report,
}: {
  tools: readonly TargetTool[];
  report?: Stage4HardeningReport;
}) {
  return (
    <section id="hardening" className="dashboard-section hardening-section" aria-labelledby="hardening-heading">
      <SectionHeading
        eyebrow="Hardening"
        title={report === undefined ? "Baseline Policy Recommendations" : "Before / After Policy Hardening"}
        description={
          report === undefined
            ? "Metadata-based preview only. Recommendations are not autonomously generated and no policy is applied."
            : "Deterministic local enforcement of the generated proposal against the same scenarios. Every result below is backed by policy-decision and replay evidence."
        }
        headingId="hardening-heading"
        aside={<Shield aria-hidden="true" size={22} />}
      />
      {report === undefined ? <MetadataPreview tools={tools} /> : <HardeningResults report={report} />}
    </section>
  );
}
