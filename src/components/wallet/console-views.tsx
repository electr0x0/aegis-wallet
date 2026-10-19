"use client";

import { useState, type ReactNode } from "react";
import { Download, ExternalLink, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { SpotlightCard } from "@/components/godui/spotlight-card";
import { BentoCard, BentoGrid } from "@/components/godui/bento-grid";
import {
  AgentStep,
  AgentTimeline,
  type StepStatus,
} from "@/components/godui/agent-timeline";
import { FilterBar, type FilterValue } from "@/components/godui/filter-bar";
import { NumberTicker } from "@/components/godui/number-ticker";
import { cn } from "@/lib/utils";
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
  treasury: "Treasury mandates",
  policy: "Guardrails & Policy",
  evidence: "Execution Evidence",
  proof: "Judge proof",
};
const TIERS = ["TIER_0", "TIER_1_AUTO", "TIER_2_HITL", "BLOCKED", "SETUP"];
const tierName = (tier: string) =>
  ({
    TIER_0: "Tier 0",
    TIER_1_AUTO: "Tier 1",
    TIER_2_HITL: "Tier 2",
    BLOCKED: "Blocked",
    SETUP: "Setup",
  })[tier] ?? tier.replaceAll("_", " ");
const readable = (s: string) => s.replaceAll("_", " ");

function auditStepStatus(status: string): StepStatus {
  if (["CONFIRMED", "COMPLETED", "TIER_2_AUTH_SUCCESS"].includes(status))
    return "success";
  if (
    [
      "BLOCKED",
      "REVERTED",
      "REVERTED_BY_GUARD",
      "REJECTED",
      "TIER_2_AUTH_FAILED",
    ].includes(status)
  )
    return "error";
  // Submitted and unresolved operations are never presented as successful.
  return "pending";
}

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
    <BentoCard className={cn("min-w-0 p-0", className)}>
      <header className="flex min-h-11 shrink-0 items-center justify-between gap-3 border-b px-4 py-2">
        <h2 className="text-xs font-semibold">{title}</h2>
        {action}
      </header>
      <div className="min-w-0 flex-1 p-4">{children}</div>
    </BentoCard>
  );
}
export function TierBadge({ tier }: { tier: string }) {
  return (
    <span
      className={cn(
        "inline-flex whitespace-nowrap rounded-md border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground",
        tier === "TIER_1_AUTO" &&
          "border-[var(--emerald-line)] bg-accent text-primary",
        tier === "TIER_2_HITL" &&
          "border-[var(--amber-line)] bg-[var(--amber-tint)] text-[var(--amber)]",
        tier === "BLOCKED" &&
          "border-[var(--red-line)] bg-[var(--red-tint)] text-destructive",
      )}
      data-tier={tier}
    >
      {tierName(tier)}
    </span>
  );
}
export function TransactionLink({ hash }: { hash?: string }) {
  return hash ? (
    <a
      className="inline-flex items-center gap-1 font-mono text-[10px] text-primary [overflow-wrap:anywhere] hover:underline"
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
      <SpotlightCard
        className="wallet-card rounded-lg border-transparent bg-foreground p-3.5 text-background"
        glowColor="rgba(255,255,255,.08)"
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-medium">
            {live?.mode === "guard" ? "AgentGuard treasury" : "Agent wallet"}
          </h3>
          <span className="font-mono text-[9px] text-emerald-200">
            {!snapshot ? "CONNECTING" : live ? "CONNECTED" : "UNAVAILABLE"}
          </span>
        </div>
        {live ? (
          <a
            className="mt-2.5 inline-flex items-center gap-2 font-mono text-xs"
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
      <div className="mt-4 mb-1 flex justify-between gap-2 text-[9px] tracking-wide text-muted-foreground uppercase">
        <span>Asset</span>
        <span>Balance / reference value</span>
      </div>
      {["ETH", "WETH", "USDC"].map((token, i) => (
        <div
          key={token}
          className="flex items-center gap-2 border-b py-2.5 text-xs"
        >
          <span
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded-full text-xl",
              [
                "bg-slate-100 text-slate-600",
                "bg-purple-50 text-purple-600",
                "bg-blue-50 text-blue-600",
              ][i],
            )}
          >
            {token === "USDC" ? "$" : "Ξ"}
          </span>
          <div>
            <b className="font-medium">{token}</b>
            <small className="mt-0.5 block text-[10px] text-muted-foreground">
              {["Ethereum", "Wrapped Ethereum", "USD Coin"][i]}
            </small>
          </div>
          <div className="ml-auto text-right font-mono">
            <b className="font-medium">
              {live
                ? Number(live.balances[token]).toFixed(token === "USDC" ? 2 : 6)
                : "—"}
            </b>
            <small className="mt-0.5 block text-[10px] text-muted-foreground">
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
      <p className="mt-1 mb-6 text-[27px] font-semibold tracking-tight">
        {live ? (
          <>
            $
            <NumberTicker
              key={live.totalUsd}
              value={live.totalUsd}
              startValue={live.totalUsd}
              decimalPlaces={2}
              className="tracking-tight"
            />
          </>
        ) : (
          "—"
        )}
        <span className="mt-1 block text-[11px] font-normal tracking-normal text-muted-foreground">
          Reference portfolio value
        </span>
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
                className={cn(
                  "h-1.5",
                  [
                    "[&_[data-slot=progress-indicator]]:bg-slate-500",
                    "[&_[data-slot=progress-indicator]]:bg-purple-400",
                    "",
                  ][i],
                )}
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
        <span
          className={cn(
            "rounded-md border bg-muted px-2 py-0.5 font-mono text-[10px]",
            pending.length > 0 &&
              "border-[var(--amber-line)] bg-[var(--amber-tint)] text-[var(--amber)]",
          )}
        >
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
        <div className="flex min-h-32 flex-col items-center justify-center gap-2 p-5 text-center text-xs text-muted-foreground">
          <ShieldCheck size={24} />
          <p className="font-medium text-foreground">No approvals waiting</p>
          <span className="max-w-56 text-[11px]">
            Transactions that need your judgment appear here.
          </span>
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
        <p className="py-8 text-center text-xs text-muted-foreground">
          No audit events recorded for this account.
        </p>
      ) : (
        <AgentTimeline aria-label="Recent audit events">
          {recent.map((entry, index) => (
            <AgentStep
              key={entry.id}
              status={auditStepStatus(entry.status)}
              last={index === recent.length - 1}
              title={<span className="text-xs">{entry.intent}</span>}
              meta={
                <time
                  dateTime={entry.timestamp}
                  className="font-mono text-[10px]"
                >
                  {new Date(entry.timestamp).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              }
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <TierBadge tier={entry.tier} />
                <span className="text-[10px]">{readable(entry.status)}</span>
              </div>
              <p>{entry.rationale ?? entry.reasons.join("; ")}</p>
              <TransactionLink hash={entry.txHash} />
            </AgentStep>
          ))}
        </AgentTimeline>
      )}
    </ConsoleCard>
  );
}
export function CommandCenter() {
  return (
    <BentoGrid columns={2} className="console-grid items-start auto-rows-auto">
      <div className="flex min-w-0 flex-col gap-4">
        <WalletOverview />
        <PendingApprovals />
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <AssetAllocation />
        <RecentEvents />
      </div>
    </BentoGrid>
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
      <div className="grid grid-cols-1 gap-2 @min-[521px]:grid-cols-3">
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
    <BentoGrid columns={2} className="console-grid items-start auto-rows-auto">
      <div className="flex min-w-0 flex-col gap-4">
        <WalletOverview />
        <ConsoleCard title="Custody & session guard">
          <GuardPanel guard={snapshot?.guard} live={live} loading={!snapshot} />
          <div className="mt-4 border-t pt-4">
            <p className="section-label">Whitelisted savings vault</p>
            {live?.vault ? (
              <a
                className="mt-2 inline-flex items-center gap-1 break-all font-mono text-[10px] text-primary hover:underline"
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
      <div className="flex min-w-0 flex-col gap-4">
        <AssetAllocation />
        <RunwayCalculator />
      </div>
    </BentoGrid>
  );
}
export function EvidenceView() {
  const { snapshot, exportEvidence } = useWallet();
  const [filters, setFilters] = useState<FilterValue>({});
  const [search, setSearch] = useState("");
  const all = snapshot?.ledger.logs ?? [];
  const facets = [
    {
      id: "tier",
      label: "Permission tier",
      options: TIERS.map((value) => ({
        value,
        label: tierName(value),
        count: all.filter((e) => e.tier === value).length,
      })),
    },
    {
      id: "status",
      label: "Status",
      options: [...new Set(all.map((e) => e.status))].sort().map((value) => ({
        value,
        label: readable(value),
        count: all.filter((e) => e.status === value).length,
      })),
    },
    {
      id: "simulation",
      label: "Pre-flight",
      options: [...new Set(all.map((e) => e.simulation))]
        .sort()
        .map((value) => ({
          value,
          label: readable(value),
          count: all.filter((e) => e.simulation === value).length,
        })),
    },
  ];
  const logs = [...all]
    .reverse()
    .filter(
      (entry) =>
        Object.entries(filters).every(
          ([key, values]) =>
            !values.length ||
            values.includes(entry[key as "tier" | "status" | "simulation"]),
        ) &&
        `${entry.intent} ${entry.status} ${entry.txHash ?? ""}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    );
  return (
    <div className="min-w-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Execution Evidence</h1>
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
      <div className="my-4 flex flex-wrap items-center gap-3">
        <FilterBar
          aria-label="Filter execution evidence"
          facets={facets}
          value={filters}
          onChange={setFilters}
        />
        <Input
          aria-label="Search audit events"
          placeholder="Search intent, status or hash…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 min-w-44 flex-1 basis-52 text-xs"
        />
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
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
          <div className="p-8 text-center text-xs text-muted-foreground">
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
