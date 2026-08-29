import { Activity, CheckCircle2, ShieldAlert } from "lucide-react";

import type { DeterministicAssessmentReport } from "@mcp-breaker/shared";

export function DashboardOverview({ report }: { report: DeterministicAssessmentReport }) {
  const score = report.securityAssessment.score;
  const counts = report.securityAssessment.findingCounts;
  const riskLevel =
    score <= 25 ? "CRITICAL" : score <= 50 ? "HIGH" : score <= 75 ? "MEDIUM" : score <= 90 ? "LOW" : "MINIMAL";

  return (
    <section aria-labelledby="assessment-heading" className="overview-grid">
      <div className="score-panel">
        <div className="section-kicker">
          <ShieldAlert aria-hidden="true" size={16} /> Security score
        </div>
        <div className="score-content">
          <div aria-label={`Security score ${score} out of 100`} className="score-ring" style={{ "--score": score } as React.CSSProperties}>
            <strong>{score}</strong>
            <span>/100</span>
          </div>
          <div>
            <p className="eyebrow">Risk level</p>
            <p className={`risk-level risk-${riskLevel.toLowerCase()}`}>{riskLevel}</p>
            <p className="muted compact">Verified runtime findings only</p>
          </div>
        </div>
      </div>

      <div className="assessment-panel">
        <div className="section-kicker">
          <Activity aria-hidden="true" size={16} /> Current assessment
        </div>
        <div className="assessment-title-row">
          <div>
            <p className="eyebrow">Target</p>
            <h1 id="assessment-heading">Demo Developer Agent</h1>
          </div>
          <span className="status-badge"><CheckCircle2 aria-hidden="true" size={14} /> Completed</span>
        </div>
        <dl className="metric-grid">
          <div><dt>Scenarios</dt><dd>{report.counts.scenariosExecuted}</dd></div>
          <div><dt>Verified findings</dt><dd>{report.verifiedFindings.length}</dd></div>
          <div><dt>Critical</dt><dd className="severity-critical">{counts.CRITICAL}</dd></div>
          <div><dt>High</dt><dd className="severity-high">{counts.HIGH}</dd></div>
          <div><dt>Medium</dt><dd className="severity-medium">{counts.MEDIUM}</dd></div>
          <div><dt>Pass</dt><dd className="severity-pass">{report.counts.passes}</dd></div>
        </dl>
      </div>
    </section>
  );
}
