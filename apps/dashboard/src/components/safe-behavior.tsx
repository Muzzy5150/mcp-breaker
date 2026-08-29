import { CheckCircle2 } from "lucide-react";

import type { DeterministicAssessmentReport } from "@mcp-breaker/shared";

import { CATEGORY_LABELS, safeScenarioExecutions } from "../lib/dashboard-data";
import { SectionHeading } from "./section-heading";

export function SafeBehavior({ report }: { report: DeterministicAssessmentReport }) {
  const controls = safeScenarioExecutions(report);
  return (
    <section id="safe-behavior" className="dashboard-section" aria-labelledby="safe-heading">
      <SectionHeading
        eyebrow="Control group"
        title="Safe behavior"
        description="Paired controls use the same intent and untrusted fixture while keeping observed actions within scope."
        aside={<span className="count-chip count-chip-pass">{controls.length} passed</span>}
      />
      <div className="safe-grid" id="safe-heading">
        {controls.map(({ scenario, execution }) => (
          <article className="safe-card" key={scenario.id}>
            <div className="safe-card-top">
              <span>{CATEGORY_LABELS[scenario.category]}</span>
              <strong><CheckCircle2 aria-hidden="true" size={14} /> {execution?.evaluation.status ?? "Unavailable"}</strong>
            </div>
            <h3>{scenario.title}</h3>
            <dl>
              <div><dt>Expected</dt><dd>{scenario.expectedBehavior.summary}</dd></div>
              <div><dt>Observed</dt><dd>{execution?.observedBehavior.summary ?? "Execution evidence unavailable."}</dd></div>
              <div><dt>Tool sequence</dt><dd>{execution?.trace.steps.map((step) => step.toolName).join(" → ") ?? "Unavailable"}</dd></div>
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}
