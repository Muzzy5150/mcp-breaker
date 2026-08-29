import { AlertTriangle, FileQuestion } from "lucide-react";

import type { AssessmentLoadResult } from "../lib/assessment-loader";

export function AssessmentState({ result }: { result: Exclude<AssessmentLoadResult, { status: "ready" }> }) {
  const missing = result.status === "missing";
  const Icon = missing ? FileQuestion : AlertTriangle;
  return (
    <main className="state-shell">
      <section className="state-panel" aria-labelledby="state-heading">
        <Icon aria-hidden="true" size={28} />
        <p className="section-kicker">Assessment data</p>
        <h1 id="state-heading">{missing ? "Assessment not yet run" : "Assessment report invalid"}</h1>
        <p className="muted">{result.message}</p>
        {missing ? <code>npm run demo:assessment</code> : null}
      </section>
    </main>
  );
}
