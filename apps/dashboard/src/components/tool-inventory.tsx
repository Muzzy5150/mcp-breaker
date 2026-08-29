import { Check, ShieldAlert } from "lucide-react";

import type { DeterministicAssessmentReport, TargetTool } from "@mcp-breaker/shared";

import { SectionHeading } from "./section-heading";

function approvalLabel(tool: TargetTool): string {
  return tool.approvalNormallyRequired ? "Approval required" : "Auto allowed";
}

export function ToolInventory({
  report,
  tools,
}: {
  report: DeterministicAssessmentReport;
  tools: readonly TargetTool[];
}) {
  const affected = new Set(report.verifiedFindings.map((finding) => finding.targetTool));
  return (
    <section id="tools" className="dashboard-section" aria-labelledby="tools-heading">
      <SectionHeading
        eyebrow="MCP surface"
        title="Tool inventory"
        description="Risk and approval posture come directly from the Stage 1 demo-target metadata."
        aside={<span className="count-chip">{tools.length} tools</span>}
        headingId="tools-heading"
      />
      <div className="tool-grid">
        {tools.map((tool) => {
          const hasFinding = affected.has(tool.name);
          return (
            <article className={`tool-card${hasFinding ? " tool-card-affected" : ""}`} key={tool.name}>
              <div className="tool-title-row">
                <code>{tool.name}</code>
                {hasFinding ? (
                  <span className="finding-flag"><ShieldAlert aria-hidden="true" size={13} /> Finding detected</span>
                ) : (
                  <span className="clear-flag"><Check aria-hidden="true" size={13} /> No finding</span>
                )}
              </div>
              <div className="risk-tags">
                {tool.riskClasses.map((risk) => <span key={risk}>{risk}</span>)}
              </div>
              <p>{tool.description}</p>
              <div className="approval-row">
                <span>Approval posture</span>
                <strong>{approvalLabel(tool)}</strong>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
