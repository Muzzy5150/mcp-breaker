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

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#overview" aria-label="MCP Breaker overview">
          <NeonRGBTextEffect text="MCP BREAKER" className="brand-effect" />
          <span className="brand-subtitle">Security evidence</span>
        </a>
        <nav aria-label="Dashboard sections">
          <a href="#tools">Tools</a>
          <a href="#findings">Findings</a>
          <a href="#safe-behavior">Safe behavior</a>
          <a href="#hardening">Hardening</a>
        </nav>
        <span className="demo-label"><span aria-hidden="true" />Deterministic local demo</span>
      </header>
      <main id="overview" className="dashboard-main">
        <div className="intro-row">
          <div>
            <p className="section-kicker">Assessment / Latest run</p>
            <p className="product-thesis">Tests how safely an AI agent uses its tools, verifies unsafe behavior through replay, and shows exactly what went wrong.</p>
          </div>
          <p className="run-id">Run <code>{result.report.runId}</code></p>
        </div>
        <SecurityDashboard report={result.report} />
      </main>
      <footer><span>MCP Breaker</span><span>Deterministic evaluation engine · Stage 3</span></footer>
    </div>
  );
}
