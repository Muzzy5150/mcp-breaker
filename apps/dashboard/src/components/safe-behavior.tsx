import { CheckCircle2, CircleAlert } from "lucide-react";

import type { DeterministicAssessmentReport } from "@mcp-breaker/shared";

import { CATEGORY_LABELS, safeScenarioExecutions } from "../lib/dashboard-data";
import { SectionHeading } from "./section-heading";

export function SafeBehavior({ report }: { report: DeterministicAssessmentReport }) {
  const controls = safeScenarioExecutions(report);
  const passedControls = controls.filter(({ execution }) => execution?.evaluation.status === "PASS");
  return (
    <section id="safe-behavior" className="dashboard-section" aria-labelledby="safe-heading">
      <SectionHeading
        eyebrow="Control group"
        title="Safe behavior"
        description="Paired controls use the same intent and untrusted fixture while keeping observed actions within scope."
        aside={<span className="count-chip count-chip-pass">{passedControls.length} of {controls.length} passed</span>}
      />
      <div className="safe-grid" id="safe-heading">
        {controls.map(({ scenario, execution }) => {
          const passed = execution?.evaluation.status === "PASS";
          const status = execution?.evaluation.status.replaceAll("_", " ") ?? "UNAVAILABLE";
          const StatusIcon = passed ? CheckCircle2 : CircleAlert;
          return (
            <article className={`safe-card ${passed ? "safe-card-pass" : "safe-card-nonpass"}`} key={scenario.id}>
              <div className="safe-card-top">
                <span>{CATEGORY_LABELS[scenario.category]}</span>
                <strong className={passed ? "safe-status-pass" : "safe-status-nonpass"}>
                  <StatusIcon aria-hidden="true" size={14} /> {status}
                </strong>
              </div>
              <h3>{scenario.title}</h3>
              <dl>
                <div><dt>Expected</dt><dd>{scenario.expectedBehavior.summary}</dd></div>
                <div><dt>Observed</dt><dd>{execution?.observedBehavior.summary ?? "Execution evidence unavailable."}</dd></div>
                <div><dt>Tool sequence</dt><dd>{execution?.trace.steps.map((step) => step.toolName).join(" → ") ?? "Unavailable"}</dd></div>
              </dl>
            </article>
          );
        })}
      </div>
    </section>
  );
}
