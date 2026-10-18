"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MotionConfig } from "framer-motion";
import {
  Activity,
  ArrowUpRight,
  Layers,
  LockKeyhole,
  ShieldCheck,
  Terminal,
  Wallet,
  X,
} from "@/components/wallet/icons";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/wallet/app-sidebar";
import { MetricCard } from "@/components/wallet/metric-card";
import { IntentStudio } from "@/components/wallet/intent-studio";
import { Telemetry } from "@/components/wallet/telemetry";
import type { AgentMessage, Snapshot } from "@/components/wallet/types";
import type { Policy } from "@/lib/security/policyEngine";

export default function Home() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [tab, setTab] = useState("portfolio");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [notice, setNotice] = useState("");
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/agent");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setSnapshot(data);
    } catch (error) {
      setNotice((error as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 30000);
    return () => clearInterval(timer);
  }, [refresh]);

  async function request(body: unknown) {
    if (inFlight.current)
      throw new Error("An operation is already in progress.");
    inFlight.current = true;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      return data.result;
    } finally {
      inFlight.current = false;
      setBusy(false);
      void refresh();
    }
  }

  async function send(text: string) {
    if (!text.trim() || inFlight.current) return;
    const id = crypto.randomUUID();
    try {
      const result = await request({ type: "intent", prompt: text });
      const serialized = JSON.stringify(result, null, 2);
      const status = serialized.includes("BLOCKED")
        ? "error"
        : serialized.includes("TIER_2_HITL")
          ? "pending"
          : "success";
      setMessages((current) => [
        ...current,
        { id, intent: text, result: serialized, status },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        { id, intent: text, result: (error as Error).message, status: "error" },
      ]);
    }
  }

  async function decide(id: string, approve: boolean) {
    try {
      const result = await request({ type: "approval", id, approve });
      const blocked = result?.decision?.tier === "BLOCKED";
      setNotice(
        blocked
          ? `Blocked by the latest policy check: ${result.decision.reasons.join("; ")}`
          : approve
            ? `Transaction status: ${result.status || "submitted"}. See Evidence for details.`
            : "Proposal rejected. No transaction broadcast.",
      );
    } catch (error) {
      setNotice((error as Error).message);
    }
  }

  async function savePolicy(policy: Policy) {
    try {
      await request({
        type: "policy",
        policy: {
          ...policy,
          whitelistedAddresses: policy.whitelistedAddresses
            .map((value) => value.trim())
            .filter(Boolean),
        },
      });
      setNotice("Permission policy saved.");
    } catch (error) {
      setNotice((error as Error).message);
    }
  }

  function exportEvidence() {
    const logs = snapshot?.ledger.logs || [];
    const markdown =
      "# Deliverable 06 — Base Sepolia execution evidence\n\nExported " +
      new Date().toISOString() +
      "\n\n" +
      logs
        .map(
          (entry) =>
            `## ${entry.timestamp} — ${entry.status}\n- Intent: ${entry.intent}\n- Tier: ${entry.tier}\n- Simulation: ${entry.simulation}\n- Risk: ${entry.riskScore}\n- Reasons: ${entry.reasons.join("; ")}\n- Transaction: ${entry.txHash ? `https://sepolia.basescan.org/tx/${entry.txHash}` : "No transaction broadcast"}\n`,
        )
        .join("\n");
    for (const [name, content, type] of [
      [
        "aegis-evidence.json",
        JSON.stringify(logs, null, 2),
        "application/json",
      ],
      ["aegis-evidence.md", markdown, "text/markdown"],
    ]) {
      const url = URL.createObjectURL(new Blob([content], { type }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = name;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  const live = snapshot?.portfolio;
  const logs = snapshot?.ledger.logs || [];
  const pending =
    snapshot?.ledger.pending.filter(
      (proposal) => proposal.status === "AWAITING_HITL_APPROVAL",
    ) || [];
  const latest = [
    ...new Map(
      logs.map((entry) => [entry.operationId || entry.id, entry]),
    ).values(),
  ];
  const spent = latest
    .filter(
      (entry) =>
        entry.tier === "TIER_1_AUTO" &&
        ["CONFIRMED", "SUBMITTED", "BROADCASTING"].includes(entry.status) &&
        Date.now() - Date.parse(entry.timestamp) < 86400000,
    )
    .reduce((sum, entry) => sum + entry.usd, 0);
  const limit = snapshot?.policy.tier1DailyLimitUsd ?? 5;
  const navigate = (view: string) => {
    setTab(view);
    document.getElementById("telemetry")?.scrollIntoView({ block: "start" });
  };

  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider delayDuration={250}>
        <SidebarProvider className="app-shell">
          <AppSidebar active={tab} onNavigate={navigate} />
          <main className="app-main">
            <header className="app-header">
              <div className="header-identity">
                <SidebarTrigger />
                <a href="/" className="wordmark">
                  aegis<span>wallet</span>
                  <small>BETA / 01</small>
                </a>
              </div>
              <div className="network-status">
                <span>
                  <i /> Base Sepolia
                </span>
                <span className="network-badge">TESTNET</span>
              </div>
            </header>
            <section className="page-heading">
              <div>
                <div className="eyebrow">
                  WORKSPACE <span>/</span> AGENT CONTROL
                </div>
                <h1>
                  Autonomy, within bounds<span>.</span>
                </h1>
                <p>
                  Your on-chain agent. Your rules. Every action accounted for.
                </p>
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
                progress={
                  limit > 0 ? (spent / limit) * 100 : spent > 0 ? 100 : 0
                }
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
            {snapshot?.error && (
              <div className="setup-banner" role="status">
                <Terminal size={18} />
                <div>
                  <b>Wallet connection needs attention</b>
                  <p>{snapshot.error}</p>
                </div>
                <code>pnpm setup-wallets</code>
              </div>
            )}
            {notice && (
              <div className="notice-banner" role="status">
                <ShieldCheck size={17} className="shrink-0" />
                <p>{notice}</p>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Dismiss notification"
                  onClick={() => setNotice("")}
                >
                  <X size={15} />
                </Button>
              </div>
            )}
            <div className="dashboard-grid">
              <IntentStudio
                messages={messages}
                pending={pending}
                busy={busy}
                onSend={send}
                onDecide={decide}
              />
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
            <footer className="app-footer">
              <span>
                <ShieldCheck size={13} />
                Trust the boundaries. Verify the execution.
              </span>
              <a
                href="https://sepolia.basescan.org"
                target="_blank"
                rel="noreferrer"
              >
                BASE SEPOLIA · 84532
                <ArrowUpRight size={12} />
              </a>
            </footer>
          </main>
        </SidebarProvider>
      </TooltipProvider>
    </MotionConfig>
  );
}
