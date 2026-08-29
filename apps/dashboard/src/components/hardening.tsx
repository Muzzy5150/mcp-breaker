import { LockKeyhole, Shield } from "lucide-react";

import type { TargetTool } from "@mcp-breaker/shared";

import { SectionHeading } from "./section-heading";

export function Hardening({ tools }: { tools: readonly TargetTool[] }) {
  const recommendations = tools.filter((tool) => tool.approvalNormallyRequired);
  return (
    <section id="hardening" className="dashboard-section hardening-section" aria-labelledby="hardening-heading">
      <SectionHeading
        eyebrow="Hardening"
        title="Baseline Policy Recommendations"
        description="Metadata-based preview only. Recommendations are not autonomously generated and no policy is applied."
        aside={<Shield aria-hidden="true" size={22} />}
      />
      <div className="hardening-list" id="hardening-heading">
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
    </section>
  );
}
