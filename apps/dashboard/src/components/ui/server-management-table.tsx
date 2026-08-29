import type { ReactNode } from "react";

import { cn } from "../../lib/utils";

interface ManagementColumn {
  key: string;
  label: string;
  className?: string;
}

interface ServerManagementTableProps {
  title: string;
  description: string;
  summary: string;
  columns: readonly ManagementColumn[];
  children: ReactNode;
  className?: string;
  tone?: "default" | "danger";
}

export function ServerManagementTable({
  title,
  description,
  summary,
  columns,
  children,
  className,
  tone = "default",
}: ServerManagementTableProps) {
  return (
    <div className={cn("management-table-shell", tone === "danger" && "management-table-danger", className)}>
      <div className="management-table-toolbar">
        <div className="management-table-title">
          <span aria-hidden="true" className="management-live-dot" />
          <div>
            <strong>{title}</strong>
            <span>{description}</span>
          </div>
        </div>
        <span className="management-summary">{summary}</span>
      </div>
      <div className="management-table-columns" aria-hidden="true">
        {columns.map((column) => (
          <span className={column.className} key={column.key}>{column.label}</span>
        ))}
      </div>
      <div className="management-table-rows">{children}</div>
    </div>
  );
}
