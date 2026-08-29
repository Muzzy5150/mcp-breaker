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
}

export function ServerManagementTable({
  title,
  description,
  summary,
  columns,
  children,
  className,
}: ServerManagementTableProps) {
  return (
    <div className={cn("management-table-shell", className)}>
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
      <div className="management-table-scroll">
        <table className="management-table">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr>
              {columns.map((column) => (
                <th className={column.className} key={column.key} scope="col">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}
