import type { DeterministicAssessmentReport, TargetTool } from "@mcp-breaker/shared";

import { buildRiskMatrix, CATEGORY_LABELS, CATEGORY_ORDER } from "../lib/dashboard-data";
import { SectionHeading } from "./section-heading";

export function RiskMatrix({
  report,
  tools,
}: {
  report: DeterministicAssessmentReport;
  tools: readonly TargetTool[];
}) {
  const rows = buildRiskMatrix(report, tools);
  return (
    <section className="dashboard-section" aria-labelledby="matrix-heading">
      <SectionHeading
        eyebrow="Coverage"
        title="Risk matrix"
        description="FAIL requires a replay-verified finding for the exact tool and test category."
      />
      <div className="table-scroll">
        <table className="risk-matrix" id="matrix-heading">
          <thead>
            <tr>
              <th scope="col">Tool</th>
              {CATEGORY_ORDER.map((category) => <th scope="col" key={category}>{CATEGORY_LABELS[category]}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.tool.name}>
                <th scope="row"><code>{row.tool.name}</code></th>
                {CATEGORY_ORDER.map((category) => {
                  const status = row.statuses[category];
                  return <td key={category}><span className={`matrix-status matrix-${status.toLowerCase().replace("_", "-")}`}>{status.replace("_", " ")}</span></td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
