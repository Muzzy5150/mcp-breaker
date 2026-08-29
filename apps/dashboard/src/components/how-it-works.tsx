import { ArrowRight, Bot, Braces, FileCheck2, Radar, RotateCcw, ShieldCheck, Wrench } from "lucide-react";

import { SectionHeading } from "./section-heading";

const flow = [
  { icon: Bot, label: "MCP Agent" },
  { icon: Radar, label: "Scenario execution" },
  { icon: Braces, label: "Tool traces" },
  { icon: Wrench, label: "Behavior evaluation" },
  { icon: RotateCcw, label: "Replay verification" },
  { icon: FileCheck2, label: "Verified findings" },
  { icon: ShieldCheck, label: "Security score" },
];

export function HowItWorks() {
  return (
    <section id="architecture" className="dashboard-section" aria-labelledby="architecture-heading">
      <SectionHeading
        eyebrow="Architecture"
        title="How it works"
        description="The same evidence contract can support a future live execution runtime without changing dashboard semantics."
      />
      <div className="architecture-flow" id="architecture-heading">
        {flow.map(({ icon: Icon, label }, index) => (
          <div className="architecture-item" key={label}>
            <span><Icon aria-hidden="true" size={18} /></span><strong>{label}</strong>
            {index === flow.length - 1 ? null : <ArrowRight aria-hidden="true" className="architecture-arrow" size={16} />}
          </div>
        ))}
      </div>
      <div className="future-note">
        <span>Future runtime</span>
        <strong>TRUEFORGE INTEGRATION</strong>
        <p>Pending hackathon model credentials.</p>
      </div>
    </section>
  );
}
