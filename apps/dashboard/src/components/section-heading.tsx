import type { ReactNode } from "react";

export function SectionHeading({
  eyebrow,
  title,
  description,
  aside,
  headingId,
}: {
  eyebrow: string;
  title: string;
  description: string;
  aside?: ReactNode;
  headingId?: string;
}) {
  return (
    <div className="section-heading">
      <div>
        <p className="section-kicker">{eyebrow}</p>
        <h2 id={headingId}>{title}</h2>
        <p>{description}</p>
      </div>
      {aside === undefined ? null : <div className="section-aside">{aside}</div>}
    </div>
  );
}
