"use client";

import { useState, type ReactNode } from "react";
import { Download, ExternalLink, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { SpotlightCard } from "@/components/godui/spotlight-card";
import { ApprovalCard } from "./approval-card";
import { GuardPanel } from "./guard-panel";
import { SealBadge, VerificationBadge } from "./ledger-badges";
import { RunwayTile } from "./runway-tile";
import { useWallet } from "./wallet-provider";
import { EXPLORER, formatUsd, shortAddress } from "./types";
import type { Entry } from "@/lib/store";
import type { Treasury } from "@/lib/security/policyEngine";

export const VIEW_LABELS: Record<string, string> = {
  command: "Command Center",
  portfolio: "Portfolio & Runway",
  policy: "Guardrails & Policy",
  evidence: "Execution Evidence",
};
const TIERS = [
  "ALL",
  "TIER_0",
  "TIER_1_AUTO",
  "TIER_2_HITL",
  "BLOCKED",
  "SETUP",
];
const tierName = (tier: string) =>
  ({
    TIER_0: "Tier 0",
    TIER_1_AUTO: "Tier 1",
    TIER_2_HITL: "Tier 2",
    BLOCKED: "Blocked",
    SETUP: "Setup",
  })[tier] ?? tier.replaceAll("_", " ");
const readable = (s: string) => s.replaceAll("_", " ");

export function ConsoleCard({
  title,
  action,
  children,
  className = "",
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`console-card ${className}`}>
      <header className="console-card-header">
        <h2>{title}</h2>
        {action}
      </header>
      <div className="console-card-body">{children}</div>
    </section>
  );
}
export function TierBadge({ tier }: { tier: string }) {
  return (
    <span className="tier-badge" data-tier={tier}>
      {tierName(tier)}
    </span>
  );
}
export function TransactionLink({ hash }: { hash?: string }) {
  return hash ? (
    <a
      className="transaction-link"
      href={`${EXPLORER}/tx/${hash}`}
      target="_blank"
      rel="noreferrer"
      title={hash}
    >
      {shortAddress(hash)}
      <ExternalLink size={12} />
      <span className="sr-only">View transaction on BaseScan</span>
    </a>
  ) : (
    <span className="text-muted-foreground">—</span>
  );
}
function WalletOverview() {
  const { snapshot, refresh } = useWallet();
  const live = snapshot?.portfolio;
  return (
    <ConsoleCard
      title="On-chain portfolio"
      action={
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Refresh portfolio"
          onClick={() => void refresh()}
        >
          <RefreshCw size={15} />
        </Button>
      }
    >
      <SpotlightCard className="wallet-card" glowColor="rgba(255,255,255,.08)">
        <div className="flex items-center justify-between gap-2">
          <h3>
            {live?.mode === "guard" ? "AgentGuard treasury" : "Agent wallet"}
          </h3>
          <span className="wallet-status">
            {!snapshot ? "CONNECTING" : live ? "CONNECTED" : "UNAVAILABLE"}
          </span>
        </div>
        {live ? (
          <a
            className="wallet-link"
            href={`${EXPLORER}/address/${live.address}`}
            target="_blank"
            rel="noreferrer"
            title={live.address}
          >
            {shortAddress(live.address)} <ExternalLink size={13} />
          </a>
        ) : (
          <p className="mt-3 text-xs">Waiting for live wallet data</p>
        )}
        <p className="mt-3 text-xs opacity-70">
          Base Sepolia ·{" "}
          {live?.mode === "guard" ? "Contract custody" : "Server EOA"}{" "}
          {live?.agentGasEth !== undefined &&
            `· Gas ${Number(live.agentGasEth).toFixed(6)} ETH`}
        </p>
      </SpotlightCard>
      <div className="asset-heading">
        <span>Asset</span>
        <span>Balance / reference value</span>
      </div>
      {["ETH", "WETH", "USDC"].map((token, i) => (
        <div key={token} className="asset-row">
          <span className={`coin coin-${i}`}>
            {token === "USDC" ? "$" : "Ξ"}
          </span>
          <div>
            <b>{token}</b>
            <small>{["Ethereum", "Wrapped Ethereum", "USD Coin"][i]}</small>
          </div>
          <div className="asset-balance">
            <b>
              {live
                ? Number(live.balances[token]).toFixed(token === "USDC" ? 2 : 6)
                : "—"}
            </b>
            <small>
              {live
                ? formatUsd(
                    Number(live.balances[token]) *
                      (token === "USDC" ? 1 : 2500),
                  )
                : "Live data unavailable"}
            </small>
          </div>
        </div>
      ))}
      <p className="reference-note">
        Reference pricing: $2,500 / ETH. Testnet assets have no monetary value.
      </p>
    </ConsoleCard>
  );
}
function AssetAllocation() {
  const { snapshot } = useWallet();
  const live = snapshot?.portfolio;
  return (
    <ConsoleCard title="Asset allocation">
      <p className="allocation-total">
        {live ? formatUsd(live.totalUsd) : "—"}
        <span>Reference portfolio value</span>
      </p>
      <div className="space-y-5">
        {["ETH", "WETH", "USDC"].map((token, i) => {
          const pct =
            live && live.totalUsd > 0
              ? ((Number(live.balances[token]) *
                  (token === "USDC" ? 1 : 2500)) /
                  live.totalUsd) *
                100
              : 0;
          return (
            <div key={token}>
              <div className="mb-2 flex justify-between text-xs">
                <span>{token}</span>
                <span className="font-mono">
                  {live ? `${pct.toFixed(1)}%` : "—"}
                </span>
              </div>
              <Progress
                className={`allocation-progress allocation-${i}`}
                aria-label={`${token} allocation`}
                value={pct}
              />
            </div>
          );
        })}
      </div>
      <p className="reference-note mt-5">
        ETH and WETH are valued 1:1. Balances come directly from the selected
        account's holder.
      </p>
    </ConsoleCard>
  );
}
export function PendingApprovals() {
  const { pending, snapshot, guarded, busy, sessionLocked, decide } =
    useWallet();
  return (
    <ConsoleCard
      title="Pending Tier 2 approvals"
      action={
        <span className="count-badge" data-alert={pending.length > 0}>
          {pending.length}
        </span>
      }
    >
      {pending.length ? (
        pending.map((p) => (
          <ApprovalCard
            key={p.id}
            proposal={p}
            guarded={guarded}
            whitelist={snapshot?.policy.whitelistedAddresses}
            busy={busy || sessionLocked}
            onDecide={decide}
          />
        ))
      ) : (
        <div className="empty-console">
          <ShieldCheck size={24} />
          <p>No approvals waiting</p>
          <span>Transactions that need your judgment appear here.</span>
        </div>
      )}
    </ConsoleCard>
  );
}
function RecentEvents() {
  const { snapshot, setTab } = useWallet();
  const recent = [...(snapshot?.ledger.logs ?? [])].reverse().slice(0, 5);
  return (
    <ConsoleCard
      title="Recent audit events"
      action={
        <Button size="sm" variant="ghost" onClick={() => setTab("evidence")}>
          View all
        </Button>
      }
    >
      {!recent.length ? (
        <p className="empty-console">
          No audit events recorded for this account.
        </p>
      ) : (
        <ol className="recent-events">
          {recent.map((entry) => (
            <li key={entry.id}>
              <div className="flex items-center justify-between gap-2">
                <TierBadge tier={entry.tier} />
                <time className="font-mono text-[11px] text-muted-foreground">
                  {new Date(entry.timestamp).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </div>
              <p className="mt-2 break-words text-xs">{entry.intent}</p>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted-foreground">
                <span>{readable(entry.status)}</span>
                <TransactionLink hash={entry.txHash} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </ConsoleCard>
  );
}
export function CommandCenter() {
  return (
    <div className="command-grid">
      <div className="console-column">
        <WalletOverview />
        <PendingApprovals />
      </div>
      <div className="console-column">
        <AssetAllocation />
        <RecentEvents />
      </div>
    </div>
  );
}
function RunwayCalculator() {
  const { snapshot } = useWallet();
  const initial = snapshot?.policy.treasury;
  const [draft, setDraft] = useState<Treasury | null>(null);
  const treasury = draft ?? initial;
  return (
    <ConsoleCard title="Reserve runway calculator">
      <p className="supporting-copy mb-4">
        Preview reserve changes. These inputs do not change your saved
        permission policy.
      </p>
      <div className="runway-inputs">
        {(
          [
            ["fiatReserveUsd", "Fiat reserve (USD)"],
            ["monthlyExpensesUsd", "Monthly expenses (USD)"],
            ["minRunwayMonths", "Runway floor (months)"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="space-y-2 text-xs">
            <span>{label}</span>
            <Input
              type="number"
              min={key === "monthlyExpensesUsd" ? 0.01 : 0}
              step="0.01"
              value={treasury?.[key] ?? ""}
              onChange={(e) =>
                setDraft({
                  fiatReserveUsd: 0,
                  monthlyExpensesUsd: 1,
                  minRunwayMonths: 3,
                  ...treasury,
                  [key]: Number(e.target.value),
                })
              }
            />
          </label>
        ))}
      </div>
      {treasury ? (
        <RunwayTile
          treasury={treasury}
          holdingsUsd={snapshot?.portfolio?.totalUsd ?? null}
        />
      ) : (
        <p className="reference-note">
          Enter a fiat reserve and monthly expense estimate to calculate runway.
        </p>
      )}
    </ConsoleCard>
  );
}
export function PortfolioView() {
  const { snapshot } = useWallet();
  const live = snapshot?.portfolio ?? null;
  return (
    <div className="portfolio-grid">
      <div className="console-column">
        <WalletOverview />
        <ConsoleCard title="Custody & session guard">
          <GuardPanel guard={snapshot?.guard} live={live} loading={!snapshot} />
          <div className="vault-card">
            <p className="section-label">Whitelisted savings vault</p>
            {live?.vault ? (
              <a
                className="transaction-link break-all"
                href={`${EXPLORER}/address/${live.vault}`}
                target="_blank"
                rel="noreferrer"
              >
                {live.vault}
                <ExternalLink size={12} />
              </a>
            ) : (
              <p className="reference-note">Vault not configured.</p>
            )}
            <p className="reference-note">
              {snapshot?.activeAccount?.keyStatus === "PIN_AES_256_GCM"
                ? "PIN-encrypted software key"
                : "Environment-isolated software key"}{" "}
              · Chain 84532
            </p>
          </div>
        </ConsoleCard>
      </div>
      <div className="console-column">
        <AssetAllocation />
        <RunwayCalculator />
      </div>
    </div>
  );
}
export function EvidenceView() {
  const { snapshot, exportEvidence } = useWallet();
  const [tier, setTier] = useState("ALL");
  const [search, setSearch] = useState("");
  const logs = [...(snapshot?.ledger.logs ?? [])]
    .reverse()
    .filter(
      (entry) =>
        (tier === "ALL" || entry.tier === tier) &&
        `${entry.intent} ${entry.status} ${entry.txHash ?? ""}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    );
  return (
    <div className="evidence-view">
      <div className="view-title-row">
        <div>
          <h1>Execution Evidence</h1>
          <p className="supporting-copy">
            Deliverable 06 · sealed decisions and Base Sepolia receipts
          </p>
        </div>
        <Button variant="outline" onClick={exportEvidence}>
          <Download size={15} />
          Export Evidence
        </Button>
      </div>
      <VerificationBadge verification={snapshot?.verification} />
      <div className="evidence-filters" aria-label="Filter evidence by tier">
        {TIERS.map((value) => (
          <Button
            key={value}
            size="sm"
            variant={tier === value ? "default" : "outline"}
            aria-pressed={tier === value}
            onClick={() => setTier(value)}
          >
            {value === "ALL" ? "All tiers" : tierName(value)}
          </Button>
        ))}
        <Input
          aria-label="Search audit events"
          placeholder="Search intent, status or hash…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="evidence-table-scroll">
        <table className="evidence-table">
          <caption className="sr-only">Account execution evidence</caption>
          <thead>
            <tr>
              <th scope="col">Timestamp</th>
              <th scope="col">Intent & rationale</th>
              <th scope="col">Tier</th>
              <th scope="col">Pre-flight simulation</th>
              <th scope="col">Status</th>
              <th scope="col">BaseScan receipt</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((entry) => (
              <EvidenceRow key={entry.id} entry={entry} />
            ))}
          </tbody>
        </table>
        {!logs.length && (
          <div className="empty-console">
            No audit events match this filter.
          </div>
        )}
      </div>
      <p className="reference-note">
        Export includes all events for this account. Filters affect only the
        table.
      </p>
    </div>
  );
}
function EvidenceRow({ entry }: { entry: Entry }) {
  return (
    <tr>
      <td>
        <time dateTime={entry.timestamp}>
          {new Date(entry.timestamp).toLocaleString()}
        </time>
      </td>
      <td>
        <p className="break-words">{entry.intent}</p>
        <details className="mt-2 text-muted-foreground">
          <summary>Decision details</summary>
          <p className="mt-2">{entry.rationale ?? entry.reasons.join("; ")}</p>
          <p className="mt-1">
            Risk {entry.riskScore}/100
            {entry.gasEstimate ? ` · ${entry.gasEstimate} gas units` : ""}
          </p>
          <SealBadge entry={entry} />
        </details>
      </td>
      <td>
        <TierBadge tier={entry.tier} />
      </td>
      <td>
        <span
          className={
            entry.simulation === "PASSED" ? "text-[var(--emerald)]" : ""
          }
        >
          {readable(entry.simulation)}
        </span>
      </td>
      <td>{readable(entry.status)}</td>
      <td>
        <TransactionLink hash={entry.txHash} />
      </td>
    </tr>
  );
}
