"use client";

import { useEffect, useState } from "react";
import {
  Wallet,
  SlidersHorizontal,
  FileText,
  RefreshCw,
  ExternalLink,
  LockKeyhole,
  Download,
  Check,
  Info,
} from "@/components/wallet/icons";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { SpotlightCard } from "@/components/godui/spotlight-card";
import { NumberTicker } from "@/components/godui/number-ticker";
import {
  AgentTimeline,
  AgentStep,
  type StepStatus,
} from "@/components/godui/agent-timeline";
import type { Policy, Treasury } from "@/lib/security/policyEngine";
import type { Entry, LedgerVerification } from "@/lib/store";
import { GuardPanel } from "./guard-panel";
import { SealBadge, VerificationBadge } from "./ledger-badges";
import { RunwayTile } from "./runway-tile";
import {
  EXPLORER,
  shortAddress,
  type GuardStatus,
  type LivePortfolio,
  type Snapshot,
} from "./types";

function Portfolio({
  live,
  guard,
  treasury,
  loading,
  refresh,
}: {
  live: LivePortfolio | null;
  guard?: GuardStatus | null;
  treasury?: Treasury;
  loading: boolean;
  refresh: () => void;
}) {
  return (
    <div className="telemetry-body">
      <div className="section-heading">
        <h2>On-chain portfolio</h2>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Refresh portfolio"
              onClick={refresh}
            >
              <RefreshCw size={15} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Refresh live balances</TooltipContent>
        </Tooltip>
      </div>
      <SpotlightCard
        className="wallet-card"
        glowColor="rgba(255, 255, 255, .07)"
      >
        <div className="flex items-center gap-3">
          <div className="wallet-emblem">
            <Wallet size={21} />
          </div>
          <div>
            <h3 className="text-sm font-medium">
              {live?.mode === "guard" ? "AgentGuard wallet" : "Agent wallet"}
            </h3>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Server-side signer · Chain 84532
            </p>
          </div>
          <span className="wallet-status">
            {loading ? "CONNECTING" : live ? "CONNECTED" : "UNAVAILABLE"}
          </span>
        </div>
        {loading ? (
          <Skeleton className="mt-5 h-4 w-44" />
        ) : live ? (
          <a
            className="wallet-link"
            href={`https://sepolia.basescan.org/address/${live.address}`}
            target="_blank"
            rel="noreferrer"
            title={live.address}
          >
            {shortAddress(live.address)}
            <ExternalLink size={13} />
          </a>
        ) : (
          <p className="mt-5 text-xs text-muted-foreground">
            No live wallet data available
          </p>
        )}
        {live?.mode && (
          <p className="mt-3 font-mono text-[11px] text-muted-foreground">
            Mode ·{" "}
            {live.mode === "guard" ? "AgentGuard contract holds funds" : "EOA"}
          </p>
        )}
        {live?.agentGasEth !== undefined && (
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            Agent gas balance · {Number(live.agentGasEth).toFixed(6)} ETH
          </p>
        )}
      </SpotlightCard>
      <GuardPanel guard={guard} live={live} loading={loading} />
      <div className="asset-heading">
        <span>ASSET</span>
        <span>BALANCE / VALUE</span>
      </div>
      {["ETH", "WETH", "USDC"].map((token, index) => (
        <div className="asset-row" key={token}>
          <div className={`coin coin-${index}`}>
            {token === "USDC" ? "$" : "Ξ"}
          </div>
          <div>
            <b>{token}</b>
            <small>{["Ethereum", "Wrapped Ethereum", "USD Coin"][index]}</small>
          </div>
          <div className="asset-balance">
            {loading ? (
              <Skeleton className="h-4 w-24" />
            ) : (
              <>
                <b>
                  {live
                    ? Number(live.balances[token]).toFixed(
                        token === "USDC" ? 2 : 6,
                      )
                    : "—"}
                </b>
                <small>
                  {live
                    ? `$${(Number(live.balances[token]) * (token === "USDC" ? 1 : 2500)).toFixed(2)}`
                    : "No live data"}
                </small>
              </>
            )}
          </div>
        </div>
      ))}
      <div className="mt-6">
        <div className="section-label mb-4">PORTFOLIO ALLOCATION</div>
        <div className="space-y-3">
          {["ETH", "WETH", "USDC"].map((token, index) => {
            const allocation =
              live && live.totalUsd > 0
                ? ((Number(live.balances[token]) *
                    (token === "USDC" ? 1 : 2500)) /
                    live.totalUsd) *
                  100
                : 0;
            return (
              <div className="allocation-row" key={token}>
                <span>{token}</span>
                <Progress
                  value={allocation}
                  aria-label={`${token} allocation`}
                  className={`allocation-progress allocation-${index}`}
                />
                <span>{live ? `${allocation.toFixed(0)}%` : "—"}</span>
              </div>
            );
          })}
        </div>
      </div>
      <RunwayTile
        treasury={treasury}
        holdingsUsd={live ? live.totalUsd : null}
      />
      <div className="vault-card">
        <div className="section-label">
          SAVINGS VAULT (OWNER) <LockKeyhole size={12} />
        </div>
        <p>
          {live?.vault ? (
            <a
              href={`https://sepolia.basescan.org/address/${live.vault}`}
              target="_blank"
              rel="noreferrer"
              title={live.vault}
            >
              {shortAddress(live.vault)} <ExternalLink size={12} />
            </a>
          ) : (
            "Not configured"
          )}
        </p>
        <small>Configured treasury destination</small>
      </div>
      <p className="reference-note">
        <Info size={13} /> Valuations use $2,500 / ETH. Testnet assets have no
        real monetary value.
      </p>
    </div>
  );
}

function PolicyControls({
  policy,
  busy,
  save,
}: {
  policy: Policy | null;
  busy: boolean;
  save: (policy: Policy) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Policy | null>(policy);
  useEffect(() => {
    setDraft((current) => current || policy);
  }, [policy]);
  if (!draft)
    return (
      <div className="telemetry-body space-y-6">
        <Skeleton className="h-6 w-36" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  const controls = [
    {
      key: "tier1SingleTxMaxUsd",
      label: "Single transaction cap",
      unit: "USD",
      max: 20,
      step: 0.1,
      help: "Above this value, your agent requests approval.",
    },
    {
      key: "tier1DailyLimitUsd",
      label: "Rolling 24-hour budget",
      unit: "USD",
      max: 50,
      step: 0.5,
      help: "Includes submitted and unresolved autonomous transactions.",
    },
    {
      key: "maxGasGwei",
      label: "Gas price ceiling",
      unit: "GWEI",
      max: 100,
      step: 1,
      help: "Transactions above this gas price are blocked.",
    },
  ] as const;
  return (
    <form
      className="telemetry-body"
      onSubmit={(event) => {
        event.preventDefault();
        void save(draft);
      }}
    >
      <h2 className="text-sm font-medium">Permission guardrails</h2>
      <p className="supporting-copy mt-2">
        Your rules, enforced before every broadcast.
      </p>
      <fieldset disabled={busy} className="min-w-0 space-y-7 mt-7">
        {controls.map((control) => (
          <div key={control.key}>
            <div className="flex items-center justify-between gap-4">
              <label htmlFor={control.key} className="text-xs font-medium">
                {control.label}
              </label>
              <div className="flex items-center gap-2">
                <Input
                  id={control.key}
                  type="number"
                  min={control.key === "maxGasGwei" ? 0.01 : 0}
                  max={control.key === "maxGasGwei" ? 1000 : 10000}
                  step="0.01"
                  required
                  value={draft[control.key]}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      [control.key]: Number(event.target.value),
                    })
                  }
                  className="h-8 w-20 text-right font-mono text-xs"
                />
                <span className="unit-label">{control.unit}</span>
              </div>
            </div>
            <Slider
              disabled={busy}
              aria-label={`${control.label} slider`}
              min={control.key === "maxGasGwei" ? 1 : 0}
              max={Math.max(control.max, draft[control.key])}
              step={control.step}
              value={[draft[control.key]]}
              onValueChange={([value]) =>
                setDraft({ ...draft, [control.key]: value })
              }
              className="my-4"
            />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {control.help}
            </p>
          </div>
        ))}
        <div>
          <label htmlFor="whitelist" className="text-xs font-medium">
            Whitelisted addresses
          </label>
          <Textarea
            id="whitelist"
            rows={5}
            value={draft.whitelistedAddresses.join("\n")}
            onChange={(event) =>
              setDraft({
                ...draft,
                whitelistedAddresses: event.target.value.split("\n"),
              })
            }
            className="mt-3 min-h-28 font-mono text-[11px]"
          />
          <p className="mt-2 text-[11px] text-muted-foreground">
            One complete address per line.
          </p>
        </div>
        <div className="confirmation-setting">
          <div>
            <label htmlFor="human-confirmation" className="text-xs font-medium">
              Always ask before signing
            </label>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Require human approval for every write.
            </p>
          </div>
          <Switch
            disabled={busy}
            id="human-confirmation"
            checked={draft.requireApproval}
            onCheckedChange={(checked) =>
              setDraft({ ...draft, requireApproval: checked })
            }
          />
        </div>
        <Button type="submit" disabled={busy} className="w-full">
          <Check size={15} /> Save permission policy
        </Button>
      </fieldset>
      <p className="reference-note">
        <LockKeyhole size={13} /> Approval never bypasses blacklists, simulation
        failures, or the gas ceiling.
      </p>
    </form>
  );
}

const FAILED_STATUSES = [
  "BLOCKED",
  "REVERTED",
  "REVERTED_BY_GUARD",
  "REJECTED",
];

const TIER_LABELS: Record<string, string> = {
  TIER_0: "Tier 0 · Observe",
  TIER_1_AUTO: "Tier 1 · Autonomous",
  TIER_2_HITL: "Tier 2 · Human approval",
  BLOCKED: "Blocked",
  SETUP: "Setup",
};

function auditStatus(entry: Entry): StepStatus {
  if (FAILED_STATUSES.includes(entry.status)) return "error";
  if (["BROADCASTING", "SUBMITTED"].includes(entry.status)) return "running";
  return entry.status === "AWAITING_HITL_APPROVAL" ? "pending" : "success";
}

const readable = (value: string) => value.replaceAll("_", " ");

function Evidence({
  logs,
  verification,
  onExport,
}: {
  logs: Entry[];
  verification?: LedgerVerification;
  onExport: () => void;
}) {
  return (
    <div className="telemetry-body" id="audit">
      <div className="section-heading">
        <h2>Execution evidence</h2>
        <span className="evidence-count">
          <NumberTicker value={logs.length} />
        </span>
      </div>
      <VerificationBadge verification={verification} />
      <p className="supporting-copy mb-5">
        Every decision, with a verifiable record.
      </p>
      <Button variant="outline" className="w-full" onClick={onExport}>
        <Download size={15} /> Export JSON + Markdown
      </Button>
      {!logs.length ? (
        <div className="empty-evidence">
          <FileText size={29} />
          <p>No execution evidence yet.</p>
          <span>Run a scenario to record a policy decision.</span>
        </div>
      ) : (
        <AgentTimeline className="evidence-timeline mt-7">
          {[...logs].reverse().map((entry, index) => (
            <AgentStep
              key={entry.id}
              title={TIER_LABELS[entry.tier] ?? readable(entry.tier)}
              status={auditStatus(entry)}
              meta={new Date(entry.timestamp).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
              defaultOpen={index < 3}
              last={index === logs.length - 1}
            >
              <p className="text-xs leading-relaxed text-foreground/90">
                {entry.intent}
              </p>
              <div className="audit-meta">
                <span>{readable(entry.status)}</span>
                <span>Risk {entry.riskScore}/100</span>
              </div>
              {entry.rationale && (
                <p className="mb-2 text-[11px] leading-relaxed text-foreground/90">
                  {entry.rationale}
                </p>
              )}
              <p className="break-words text-[11px] text-muted-foreground">
                Simulation: {entry.simulation}
              </p>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {entry.reasons.join(" · ")}
              </p>
              {entry.txHash && (
                <a
                  className="transaction-link"
                  href={`${EXPLORER}/tx/${entry.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  title={entry.txHash}
                >
                  BaseScan · {shortAddress(entry.txHash)}
                  <ExternalLink size={12} />
                </a>
              )}
              <SealBadge entry={entry} />
            </AgentStep>
          ))}
        </AgentTimeline>
      )}
    </div>
  );
}

export function Telemetry({
  snapshot,
  tab,
  setTab,
  busy,
  refresh,
  savePolicy,
  onExport,
}: {
  snapshot: Snapshot | null;
  tab: string;
  setTab: (tab: string) => void;
  busy: boolean;
  refresh: () => void;
  savePolicy: (policy: Policy) => Promise<void>;
  onExport: () => void;
}) {
  return (
    <section
      id="telemetry"
      className="panel telemetry-panel"
      aria-label="Wallet telemetry and settings"
    >
      <Tabs value={tab} onValueChange={setTab} className="gap-0">
        <div className="telemetry-nav">
          <TabsList
            variant="line"
            aria-label="Telemetry views"
            className="h-12 w-full justify-start"
          >
            <TabsTrigger value="portfolio">
              <Wallet size={15} /> Portfolio
            </TabsTrigger>
            <TabsTrigger value="policy">
              <SlidersHorizontal size={15} /> Guardrails
            </TabsTrigger>
            <TabsTrigger value="evidence">
              <FileText size={15} /> Evidence
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="portfolio">
          <Portfolio
            live={snapshot?.portfolio || null}
            guard={snapshot?.guard}
            treasury={snapshot?.policy.treasury}
            loading={!snapshot}
            refresh={refresh}
          />
        </TabsContent>
        <TabsContent value="policy">
          <PolicyControls
            policy={snapshot?.policy || null}
            busy={busy}
            save={savePolicy}
          />
        </TabsContent>
        <TabsContent value="evidence">
          <Evidence
            logs={snapshot?.ledger.logs || []}
            verification={snapshot?.verification}
            onExport={onExport}
          />
        </TabsContent>
      </Tabs>
      <div className="tier-guide">
        <span>
          <i />
          TIER 0<small>Observe</small>
        </span>
        <span>
          <i />
          TIER 1<small>Execute</small>
        </span>
        <span>
          <i />
          TIER 2<small>Ask first</small>
        </span>
      </div>
    </section>
  );
}
