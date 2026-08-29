import { Check, ShieldAlert, Wrench } from "lucide-react";

import type { DeterministicAssessmentReport, TargetTool } from "@mcp-breaker/shared";

import { SectionHeading } from "./section-heading";
import { ServerManagementTable } from "./ui/server-management-table";

const toolColumns = [
  { key: "number", label: "No.", className: "tool-column-number" },
  { key: "tool", label: "Tool", className: "tool-column-name" },
  { key: "risk", label: "Risk classes", className: "tool-column-risk" },
  { key: "description", label: "Description", className: "tool-column-description" },
  { key: "approval", label: "Approval", className: "tool-column-approval" },
  { key: "evidence", label: "Runtime evidence", className: "tool-column-evidence" },
] as const;

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
      <ServerManagementTable
        title="Observed tool surface"
        description="Stage 1 metadata · Stage 2 runtime evidence"
        summary={`${affected.size} linked to verified findings`}
        columns={toolColumns}
        className="tool-grid"
      >
        {tools.map((tool, index) => {
          const hasFinding = affected.has(tool.name);
          return (
            <tr className={`tool-row${hasFinding ? " tool-row-affected" : ""}`} key={tool.name}>
              <td className="tool-number">{String(index + 1).padStart(2, "0")}</td>
              <th className="tool-identity" scope="row">
                <span className="tool-identity-inner">
                  <span className="tool-icon"><Wrench aria-hidden="true" size={15} /></span>
                  <code>{tool.name}</code>
                </span>
              </th>
              <td>
                <div className="risk-tags">
                  {tool.riskClasses.map((risk) => <span key={risk}>{risk}</span>)}
                </div>
              </td>
              <td><p className="tool-description">{tool.description}</p></td>
              <td><strong className="approval-value">{approvalLabel(tool)}</strong></td>
              <td>
                {hasFinding ? (
                  <span className="finding-flag"><ShieldAlert aria-hidden="true" size={13} /> Finding detected</span>
                ) : (
                  <span className="clear-flag"><Check aria-hidden="true" size={13} /> No finding</span>
                )}
              </td>
            </tr>
          );
        })}
      </ServerManagementTable>
    </section>
  );
}
