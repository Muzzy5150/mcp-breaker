import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/utils";

export function BentoGrid({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return <div className={cn("bento-grid", className)} {...props} />;
}

export function BentoCard({
  className,
  featured = false,
  ...props
}: ComponentPropsWithoutRef<"div"> & { featured?: boolean }) {
  return (
    <div
      className={cn("bento-card", featured && "bento-card-featured", className)}
      {...props}
    />
  );
}
