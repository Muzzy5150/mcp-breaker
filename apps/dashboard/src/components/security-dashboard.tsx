import { DEMO_TOOL_METADATA } from "@mcp-breaker/demo-target";
import type { DashboardAssessmentReport, DashboardHardeningReport } from "../lib/assessment-loader";

import { AssessmentTimeline } from "./assessment-timeline";
import { DashboardOverview } from "./dashboard-overview";
import { FindingsExplorer } from "./findings-explorer";
import { Hardening } from "./hardening";
import { HowItWorks } from "./how-it-works";
import { RiskMatrix } from "./risk-matrix";
import { SafeBehavior } from "./safe-behavior";
import { ToolInventory } from "./tool-inventory";
import { HeroSection } from "./ui/hero-section-9";

export function SecurityDashboard({
  report,
  hardeningReport,
}: {
  report: DashboardAssessmentReport;
  hardeningReport?: DashboardHardeningReport;
}) {
  return (
    <>
      <HeroSection runId={report.runId}>
        <DashboardOverview report={report} />
      </HeroSection>
      <AssessmentTimeline report={report} />
      <ToolInventory report={report} tools={DEMO_TOOL_METADATA} />
      <RiskMatrix report={report} tools={DEMO_TOOL_METADATA} />
      <FindingsExplorer report={report} />
      <SafeBehavior report={report} />
      <Hardening
        tools={DEMO_TOOL_METADATA}
        {...(hardeningReport === undefined ? {} : { report: hardeningReport })}
      />
      <HowItWorks />
    </>
  );
}
