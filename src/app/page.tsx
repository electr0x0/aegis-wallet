"use client";

import {
  Activity,
  Layers,
  LockKeyhole,
  ShieldCheck,
  Wallet,
} from "@/components/wallet/icons";
import { MetricCard } from "@/components/wallet/metric-card";
import { IntentStudio } from "@/components/wallet/intent-studio";
import { Telemetry } from "@/components/wallet/telemetry";
import { useWallet } from "@/components/wallet/wallet-provider";

export default function Home() {
  const {
    snapshot,
    tab,
    setTab,
    busy,
    pending,
    spent,
    limit,
    refresh,
    savePolicy,
    exportEvidence,
  } = useWallet();
  const live = snapshot?.portfolio;
  return (
    <>
      <section className="page-heading">
        <div>
          <h1>
            Autonomy, within bounds<span>.</span>
          </h1>
          <p>Your on-chain agent. Your rules. Every action accounted for.</p>
        </div>
        <div className="protection-status">
          <ShieldCheck size={19} />
          <div>
            Deterministic protection<small>Policy engine active</small>
          </div>
        </div>
      </section>
      <section className="metrics-grid" aria-label="Wallet overview">
        <MetricCard
          label="PORTFOLIO VALUE"
          value={live?.totalUsd ?? null}
          prefix="$"
          suffix="USD"
          description="Base Sepolia · reference pricing"
          icon={Wallet}
          decimals={2}
          loading={!snapshot}
        />
        <MetricCard
          label="AUTONOMOUS SPEND"
          value={spent}
          prefix="$"
          suffix={`/ $${limit.toFixed(2)}`}
          description="Rolling 24-hour permission budget"
          icon={Activity}
          decimals={2}
          loading={!snapshot}
          progress={limit > 0 ? (spent / limit) * 100 : spent > 0 ? 100 : 0}
        />
        <MetricCard
          label="NETWORK GAS"
          value={live?.gasGwei ?? null}
          suffix="GWEI"
          description={`Ceiling ${snapshot?.policy.maxGasGwei ?? 25} gwei`}
          icon={Layers}
          decimals={4}
          loading={!snapshot}
        />
        <MetricCard
          label="AWAITING APPROVAL"
          value={pending.length}
          suffix="PROPOSALS"
          description="Human authorization before execution"
          icon={LockKeyhole}
          loading={!snapshot}
          accent={pending.length > 0}
        />
      </section>
      <div className="dashboard-grid">
        <IntentStudio />
        <Telemetry
          snapshot={snapshot}
          tab={tab}
          setTab={setTab}
          busy={busy}
          refresh={() => void refresh()}
          savePolicy={savePolicy}
          onExport={exportEvidence}
        />
      </div>
    </>
  );
}
