import { Check, Flag, Play, RotateCcw, ScanSearch, Sigma } from "lucide-react";

import type { DashboardAssessmentReport } from "../lib/dashboard-data";

import { formatTimestamp, originalExecutions } from "../lib/dashboard-data";
import { SectionHeading } from "./section-heading";

export function AssessmentTimeline({ report }: { report: DashboardAssessmentReport }) {
  const originals = originalExecutions(report);
  const startedAt = originals.map((execution) => execution.startedAt).toSorted()[0] ?? report.generatedAt;
  const steps = [
    { icon: Play, label: "Assessment started", value: formatTimestamp(startedAt) },
    { icon: ScanSearch, label: "Scenarios executed", value: String(report.counts.scenariosExecuted) },
    { icon: Flag, label: "Candidates identified", value: String(report.counts.candidates) },
    { icon: RotateCcw, label: "Candidates replayed", value: String(report.replayVerifications.length) },
    { icon: Check, label: "Reproduced", value: String(report.counts.reproduced) },
    { icon: Check, label: "Verified findings", value: String(report.verifiedFindings.length) },
    { icon: Sigma, label: "Score calculated", value: `${report.securityAssessment.score}/100 · ${formatTimestamp(report.generatedAt)}` },
  ];
  return (
    <section className="dashboard-section" aria-labelledby="timeline-heading">
      <SectionHeading
        eyebrow="Assessment lifecycle"
        title="From execution to score"
        description="Counts and boundary timestamps are taken directly from this assessment report."
      />
      <ol className="timeline" id="timeline-heading">
        {steps.map(({ icon: Icon, label, value }) => (
          <li key={label}>
            <span className="timeline-icon"><Icon aria-hidden="true" size={15} /></span>
            <span><strong>{label}</strong><small>{value}</small></span>
          </li>
        ))}
      </ol>
    </section>
  );
}
