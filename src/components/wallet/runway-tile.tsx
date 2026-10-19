"use client";

import { AlertTriangle, Info, ShieldCheck } from "@/components/wallet/icons";
import type { Treasury } from "@/lib/security/policyEngine";
import { formatUsd } from "./types";

function runwayMonths(treasury: Treasury, holdingsUsd: number | null) {
  if (holdingsUsd === null || treasury.monthlyExpensesUsd <= 0) return null;
  return (treasury.fiatReserveUsd + holdingsUsd) / treasury.monthlyExpensesUsd;
}

function FloorStatus({
  runway,
  floor,
}: {
  runway: number | null;
  floor: number;
}) {
  if (runway === null) {
    return (
      <p className="mt-1 text-xs text-muted-foreground">
        Live holdings unavailable
      </p>
    );
  }
  if (runway < floor) {
    return (
      <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-[var(--red)]">
        <AlertTriangle size={13} /> Below the {floor}-month floor
      </p>
    );
  }
  return (
    <p className="mt-1 flex items-center gap-1.5 text-xs text-[var(--emerald)]">
      <ShieldCheck size={13} /> Above the {floor}-month floor
    </p>
  );
}

export function RunwayTile({
  treasury,
  holdingsUsd,
}: {
  treasury?: Treasury;
  holdingsUsd: number | null;
}) {
  if (!treasury) return null;
  const runway = runwayMonths(treasury, holdingsUsd);
  const rows = [
    ["Fiat reserve", formatUsd(treasury.fiatReserveUsd)],
    ["Monthly expenses", formatUsd(treasury.monthlyExpensesUsd)],
    ["On-chain holdings", holdingsUsd === null ? "—" : formatUsd(holdingsUsd)],
    ["Runway floor", `${treasury.minRunwayMonths} months`],
  ];
  return (
    <section
      aria-labelledby="runway-title"
      className="mt-6 rounded-xl border border-border bg-[var(--surface)] p-4"
    >
      <h3 id="runway-title" className="section-label">
        RESERVE RUNWAY
      </h3>
      <p className="mt-3 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tracking-tight tabular-nums">
          {runway === null ? "—" : (Math.floor(runway * 10) / 10).toFixed(1)}
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">
          MONTHS NOW
        </span>
      </p>
      <FloorStatus runway={runway} floor={treasury.minRunwayMonths} />
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-mono tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="reference-note">
        <Info size={13} /> Operator-entered fiat profile (not a live bank feed).
        Runway = (fiat reserve + on-chain holdings) ÷ monthly expenses.
      </p>
    </section>
  );
}
