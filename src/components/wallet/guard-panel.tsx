"use client";

import {
  AlertTriangle,
  Clock,
  ExternalLink,
  LockKeyhole,
  ShieldCheck,
} from "@/components/wallet/icons";
import {
  EXPLORER,
  shortAddress,
  type GuardStatus,
  type LivePortfolio,
} from "./types";

export function timeLeft(expirySeconds: number): string | null {
  const seconds = expirySeconds - Date.now() / 1000;
  if (seconds <= 0) return null;
  const hours = Math.floor(seconds / 3600);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h left`;
  const minutes = Math.floor(seconds / 60) % 60;
  return `${hours}h ${minutes}m left`;
}

function SessionExpiry({ expiry }: { expiry: number }) {
  const date = new Date(expiry * 1000).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const remaining = timeLeft(expiry);
  return (
    <dd className="flex flex-wrap items-center gap-x-2">
      <span>{date}</span>
      {remaining ? (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <Clock size={12} /> {remaining}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 font-semibold text-[var(--red)]">
          <AlertTriangle size={12} /> expired
        </span>
      )}
    </dd>
  );
}

function LimitsTable({ limits }: { limits: GuardStatus["limits"] }) {
  return (
    <table className="mt-4 w-full font-mono text-[11px] tabular-nums">
      <caption className="sr-only">AgentGuard per-asset session caps</caption>
      <thead className="text-muted-foreground">
        <tr>
          <th scope="col" className="pb-1.5 text-left font-medium">
            Asset
          </th>
          <th scope="col" className="pb-1.5 text-right font-medium">
            Per tx
          </th>
          <th scope="col" className="pb-1.5 text-right font-medium">
            Per day
          </th>
          <th scope="col" className="pb-1.5 text-right font-medium">
            Spent today
          </th>
        </tr>
      </thead>
      <tbody>
        {limits.map((limit) => (
          <tr key={limit.asset} className="border-t border-border">
            <th scope="row" className="py-1.5 text-left font-semibold">
              {limit.asset}
            </th>
            <td className="py-1.5 text-right [overflow-wrap:anywhere]">
              {limit.perTx}
            </td>
            <td className="py-1.5 text-right [overflow-wrap:anywhere]">
              {limit.perDay}
            </td>
            <td className="py-1.5 text-right [overflow-wrap:anywhere]">
              {limit.spentToday}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function GuardPanel({
  guard,
  live,
  loading,
}: {
  guard?: GuardStatus | null;
  live: LivePortfolio | null;
  loading: boolean;
}) {
  if (loading) return null;
  if (!guard) {
    // Without a live portfolio (or in guard mode) a missing status means the read failed.
    const unknown = !live || live.mode === "guard";
    return (
      <p className="reference-note">
        <LockKeyhole size={13} />
        {unknown
          ? "On-chain guard status unavailable. See the connection notice."
          : "On-chain guard not deployed: EOA mode"}
      </p>
    );
  }
  return (
    <section
      aria-labelledby="guard-title"
      className="mt-6 rounded-xl border border-border bg-[var(--surface)] p-4"
    >
      <h3 id="guard-title" className="section-label">
        <ShieldCheck size={13} /> ON-CHAIN GUARD
        <span className="ml-auto">AGENTGUARD</span>
      </h3>
      <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-xs">
        <dt className="text-muted-foreground">Contract</dt>
        <dd>
          <a
            className="inline-flex items-center gap-1.5 font-mono hover:text-[var(--emerald)]"
            href={`${EXPLORER}/address/${guard.address}`}
            target="_blank"
            rel="noreferrer"
            title={guard.address}
          >
            {shortAddress(guard.address)} <ExternalLink size={12} />
          </a>
        </dd>
        <dt className="text-muted-foreground">Session key</dt>
        <dd className="font-mono" title={guard.sessionKey}>
          {shortAddress(guard.sessionKey)}
        </dd>
        <dt className="text-muted-foreground">Session expiry</dt>
        <SessionExpiry expiry={guard.sessionExpiry} />
      </dl>
      <LimitsTable limits={guard.limits} />
    </section>
  );
}
