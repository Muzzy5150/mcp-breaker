"use client";

import { AlertTriangle } from "lucide-react";

export default function DashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="state-shell">
      <section className="state-panel" aria-labelledby="runtime-error-heading">
        <AlertTriangle aria-hidden="true" size={28} />
        <p className="section-kicker">Dashboard runtime</p>
        <h1 id="runtime-error-heading">Unable to render the assessment</h1>
        <p className="muted">The dashboard encountered an unexpected local error.</p>
        <button className="retry-button" onClick={reset} type="button">Try again</button>
      </section>
    </main>
  );
}
