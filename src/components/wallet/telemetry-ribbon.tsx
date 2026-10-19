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
    <section className="telemetry-ribbon" aria-label="Live wallet telemetry">
      <div>
        <span>Portfolio Value</span>
        <strong>{live ? `${formatUsd(live.totalUsd)} USD` : "—"}</strong>
      </div>
      <div>
        <span>24h Auto Budget</span>
        <strong>
          {snapshot ? `${formatUsd(spent)} / ${formatUsd(limit)}` : "—"}
        </strong>
        <Progress
          aria-label="24-hour autonomous budget used"
          value={used}
          className="ribbon-progress"
        />
      </div>
      <div>
        <span>Base Sepolia Gas</span>
        <strong>
          {live ? `${live.gasGwei.toFixed(4)} Gwei` : "—"}
          <small>Max {snapshot?.policy.maxGasGwei ?? "—"}</small>
        </strong>
      </div>
      <div data-alert={pending.length > 0}>
        <span>Awaiting Tier 2 Approval</span>
        <strong>{snapshot ? `${pending.length} Proposals` : "—"}</strong>
      </div>
      <div className="engine-status">
        <ShieldCheck size={15} />
        <span>
          Deterministic Policy Engine
          <strong>{snapshot ? "ACTIVE" : "CONNECTING"}</strong>
        </span>
      </div>
    </section>
  );
}
