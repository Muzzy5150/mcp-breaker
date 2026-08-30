import { DEMO_TOOL_METADATA } from "@mcp-breaker/demo-target";

import { DemoAssessmentControls } from "../components/demo-assessment-controls";
import { SecurityDashboard } from "../components/security-dashboard";
import { HeroSection } from "../components/ui/hero-section-9";
import { NeonRGBTextEffect } from "../components/ui/neon-rgbtext-effect";
import { loadAssessment } from "../lib/assessment-loader";
import { getManagedDemoJob } from "../lib/demo-job";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [result, jobState] = await Promise.all([
    loadAssessment(),
    Promise.resolve(getManagedDemoJob().snapshot()),
  ]);
  const isLive = result.status === "ready" && result.report.executionMode === "TRUEFORGE_LIVE";

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
        {result.status === "ready" ? (
          <SecurityDashboard
            report={result.report}
            jobState={jobState}
            {...(result.hardeningReport === undefined ? {} : { hardeningReport: result.hardeningReport })}
          />
        ) : (
          <HeroSection
            runId="Awaiting first managed demo run"
            controls={<DemoAssessmentControls initialState={jobState} />}
          >
            <section className="empty-dashboard-preview" aria-labelledby="empty-dashboard-heading">
              <p className="section-kicker">Built-in disposable target</p>
              <h2 id="empty-dashboard-heading">MCP Breaker Demo Target</h2>
              <p>{DEMO_TOOL_METADATA.length} local tools are available for the predefined TrueForge security suite. Launch the assessment above to generate the first replay-verified report.</p>
              <div className="empty-tool-list">
                {DEMO_TOOL_METADATA.map((tool) => <code key={tool.name}>{tool.name}</code>)}
              </div>
              {result.status === "invalid" ? <p className="job-error">The previous artifact was invalid and will be replaced only after a successful managed run.</p> : null}
            </section>
          </HeroSection>
        )}
      </main>
      <footer>
        <span>MCP Breaker</span>
        <span>
          {isLive
            ? "Live TrueForge SDK evaluation · Stage 5.5"
            : result.status === "ready"
              ? `Deterministic evaluation engine · ${result.hardeningReport === undefined ? "Stage 3" : "Stage 4"}`
              : "Managed TrueForge website demo · Stage 5.5"}
        </span>
      </footer>
    </div>
  );
}
