"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Policy } from "@/lib/security/policyEngine";
import { describeError, describeResult, messageStatus } from "./agent-reply";
import {
  blockedTrip,
  refusalTrip,
  type GuardrailTrip,
} from "./security-banner";
import {
  shortAddress,
  type AgentMessage,
  type ProposalView,
  type Snapshot,
} from "./types";

type Wallet = ReturnType<typeof useWalletState>;

const WalletContext = createContext<Wallet | null>(null);

const DAY_MS = 86_400_000;
const SPEND_STATUSES = ["CONFIRMED", "SUBMITTED", "BROADCASTING"];

// Shared by the dashboard and the chat route, so moving between them keeps the conversation.
function useWalletState() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [tab, setTab] = useState("portfolio");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [notice, setNotice] = useState("");
  const [trip, setTrip] = useState<GuardrailTrip | null>(null);
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

  // Every intent and approval lands in the conversation as a readable reply.
  async function converse(intent: string, body: unknown) {
    if (inFlight.current) return;
    const message = { id: crypto.randomUUID(), intent, time: Date.now() };
    setTrip(null);
    try {
      const result = await request(body);
      setTrip(blockedTrip(result));
      const status = messageStatus(describeResult(result));
      setMessages((current) => [...current, { ...message, result, status }]);
    } catch (error) {
      const text = (error as Error).message;
      setTrip(refusalTrip(text));
      const status = messageStatus(describeError(text));
      setMessages((current) => [
        ...current,
        { ...message, error: text, status },
      ]);
    }
  }

  async function send(text: string) {
    if (!text.trim()) return;
    await converse(text, { type: "intent", prompt: text });
  }

  async function decide(id: string, approve: boolean) {
    const proposal = pending.find((item) => item.id === id);
    const verb = approve ? "Approve" : "Reject";
    const intent = proposal
      ? `${verb} ${proposal.action.amount} ${proposal.action.token} to ${shortAddress(proposal.action.recipient)}`
      : `${verb} proposal`;
    await converse(intent, { type: "approval", id, approve });
  }

  async function savePolicy(policy: Policy) {
    if (inFlight.current) return;
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

  const logs = snapshot?.ledger.logs || [];
  const pending: ProposalView[] =
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
        SPEND_STATUSES.includes(entry.status) &&
        Date.now() - Date.parse(entry.timestamp) < DAY_MS,
    )
    .reduce((sum, entry) => sum + entry.usd, 0);
  const limit = snapshot?.policy.tier1DailyLimitUsd ?? 5;
  // Guard mode routes approvals through AgentGuard even if its status read failed.
  const guarded =
    Boolean(snapshot?.guard) || snapshot?.portfolio?.mode === "guard";

  return {
    snapshot,
    tab,
    setTab,
    busy,
    messages,
    notice,
    setNotice,
    trip,
    setTrip,
    pending,
    spent,
    limit,
    guarded,
    refresh,
    send,
    decide,
    savePolicy,
    exportEvidence,
  };
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const wallet = useWalletState();
  return (
    <WalletContext.Provider value={wallet}>{children}</WalletContext.Provider>
  );
}

export function useWallet(): Wallet {
  const wallet = useContext(WalletContext);
  if (!wallet) throw new Error("useWallet must be used inside WalletProvider");
  return wallet;
}
