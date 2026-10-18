import type * as React from "react";
import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "relative overflow-hidden rounded-md bg-accent after:pointer-events-none after:absolute after:inset-0 after:-translate-x-full after:bg-linear-to-r after:from-transparent after:via-foreground/[0.06] after:to-transparent after:animate-godui-shimmer rtl:after:[animation-direction:reverse] motion-reduce:animate-pulse motion-reduce:after:hidden [&.animate-none]:animate-none [&.animate-none]:after:hidden",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
