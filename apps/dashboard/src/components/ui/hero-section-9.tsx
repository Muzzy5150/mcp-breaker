import type { ReactNode } from "react";

import { cn } from "../../lib/utils";

type HeroSectionProps = {
  runId: string;
  children: ReactNode;
  className?: string;
};

export function HeroSection({ runId, children, className }: HeroSectionProps) {
  return (
    <section className={cn("dashboard-hero", className)} aria-labelledby="dashboard-title">
      <div className="hero-light-field" aria-hidden="true">
        <span className="hero-light hero-light-wide" />
        <span className="hero-light hero-light-narrow" />
        <span className="hero-light hero-light-faint" />
      </div>

      <div className="hero-copy">
        <p className="section-kicker">Assessment / Latest run</p>
        <h1 id="dashboard-title">
          Test every tool call.
          <span>Verify every failure.</span>
        </h1>
        <p className="product-thesis">
          See how safely an AI agent uses its tools, then inspect replay-verified evidence for exactly what went wrong.
        </p>
        <p className="run-id">Run <code>{runId}</code></p>
      </div>

      <div className="hero-perspective">
        <div className="hero-product-surface">{children}</div>
      </div>
    </section>
  );
}
