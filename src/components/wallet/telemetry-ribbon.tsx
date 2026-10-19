"use client";
import { ShieldCheck } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { useWallet } from "./wallet-provider";
import { formatUsd } from "./types";

export function TelemetryRibbon() {
  const { snapshot, spent, limit, pending } = useWallet();
  const live = snapshot?.portfolio;
  const used =
    limit > 0 ? Math.min(100, (spent / limit) * 100) : spent > 0 ? 100 : 0;
  return (
    <section
      className="flex h-14 min-h-14 shrink-0 items-center justify-between gap-2.5 overflow-x-auto border-b bg-background px-4 text-[10px] text-muted-foreground [scrollbar-width:thin]"
      aria-label="Live wallet telemetry"
    >
      <div className="flex shrink-0 flex-col gap-0.5">
        <span>Portfolio Value</span>
        <strong className="whitespace-nowrap text-xs font-semibold text-foreground tabular-nums">
          {live ? `${formatUsd(live.totalUsd)} USD` : "—"}
        </strong>
      </div>
      <div className="flex shrink-0 flex-col gap-0.5">
        <span>24h Auto Budget</span>
        <strong className="whitespace-nowrap text-xs font-semibold text-foreground tabular-nums">
          {snapshot ? `${formatUsd(spent)} / ${formatUsd(limit)}` : "—"}
        </strong>
        <Progress
          aria-label="24-hour autonomous budget used"
          value={used}
          className="h-[3px] max-w-28"
        />
      </div>
      <div className="flex shrink-0 flex-col gap-0.5">
        <span>Base Sepolia Gas</span>
        <strong className="whitespace-nowrap text-xs font-semibold text-foreground tabular-nums">
          {live ? `${live.gasGwei.toFixed(4)} Gwei` : "—"}
          <small className="ml-1.5 text-[10px] font-normal text-muted-foreground">
            Max {snapshot?.policy.maxGasGwei ?? "—"}
          </small>
        </strong>
      </div>
      <div className="flex shrink-0 flex-col gap-0.5">
        <span>Awaiting Tier 2 Approval</span>
        <strong
          className="whitespace-nowrap text-xs font-semibold text-foreground tabular-nums data-[alert=true]:text-[var(--amber)]"
          data-alert={pending.length > 0}
        >
          {snapshot ? `${pending.length} Proposals` : "—"}
        </strong>
      </div>
      <div className="flex shrink-0 items-center gap-2 text-primary">
        <ShieldCheck size={15} />
        <span>
          Deterministic Policy Engine
          <strong className="block font-semibold">
            {snapshot?.policy.executionPaused
              ? "WRITES PAUSED"
              : snapshot
                ? "ACTIVE"
                : "CONNECTING"}
          </strong>
        </span>
      </div>
    </section>
  );
}
