import { AssessmentState } from "@/components/assessment-state";
import { SecurityDashboard } from "@/components/security-dashboard";
import { NeonRGBTextEffect } from "@/components/ui/neon-rgbtext-effect";
import { loadAssessment } from "@/lib/assessment-loader";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const result = await loadAssessment();
  if (result.status !== "ready") {
    return <AssessmentState result={result} />;
  }
  const isLive = result.report.executionMode === "TRUEFORGE_LIVE";

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="#overview" aria-label="MCP Breaker overview">
            <NeonRGBTextEffect text="MCP BREAKER" className="brand-effect" />
          </a>
          <nav aria-label="Dashboard sections">
            <a href="#tools">Tools</a>
            <a href="#findings">Findings</a>
            <a href="#safe-behavior">Safe behavior</a>
            <a href="#hardening">Hardening</a>
          </nav>
          <span className="demo-label">
            <span aria-hidden="true" />
            {isLive ? "Live TrueForge assessment" : "Deterministic local demo"}
          </span>
        </div>
      </header>
      <main id="overview" className="dashboard-main">
        <SecurityDashboard
          report={result.report}
          {...(result.hardeningReport === undefined ? {} : { hardeningReport: result.hardeningReport })}
        />
      </main>
      <footer>
        <span>MCP Breaker</span>
        <span>
          {isLive
            ? "Live TrueForge SDK evaluation · Stage 5"
            : `Deterministic evaluation engine · ${result.hardeningReport === undefined ? "Stage 3" : "Stage 4"}`}
        </span>
      </footer>
    </div>
  );
}
