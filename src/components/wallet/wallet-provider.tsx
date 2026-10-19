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
import type { Action } from "@/lib/security/policyEngine";
import type { PolicyComparison } from "@/lib/agent/tools";
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
  type AccountState,
} from "./types";
import { PinDialog } from "./pin-dialog";
import type { RiskProfile } from "@/lib/auth/accountStore";
import type { ExecutionProgress } from "@/lib/agent/progress";
import { readExecutionStream } from "./read-execution";
import type {
  MandateSettings,
  SweepCalculation,
} from "@/lib/treasury/calculate";

type Wallet = ReturnType<typeof useWalletState>;

const WalletContext = createContext<Wallet | null>(null);

const DAY_MS = 86_400_000;
const SPEND_STATUSES = ["CONFIRMED", "SUBMITTED", "BROADCASTING"];

// Shared by the dashboard and the chat route, so moving between them keeps the conversation.
function useWalletState() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [accountState, setAccountState] = useState<AccountState>({
    accounts: [],
    session: { status: "LOCKED" },
  });
  const [stepUp, setStepUp] = useState<{
    title: string;
    finish: (pin: string | null) => void;
  } | null>(null);
  const refreshSequence = useRef(0);
  const [tab, setTab] = useState("command");
  const [progress, setProgress] = useState<ExecutionProgress[]>([]);
  const progressRef = useRef<ExecutionProgress[]>([]);
  const [activeIntent, setActiveIntent] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [notice, setNotice] = useState("");
  const [trip, setTrip] = useState<GuardrailTrip | null>(null);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    try {
      const response = await fetch("/api/agent");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (sequence !== refreshSequence.current) return;
      if (data.accounts) setAccountState(data);
      setSnapshot(data.session?.status === "LOCKED" ? null : data);
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
    ++refreshSequence.current;
    inFlight.current = true;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: ["intent", "approval", "treasury_execute"].includes(
            (body as { type: string }).type,
          )
            ? "application/x-ndjson"
            : "application/json",
        },
        body: JSON.stringify({
          accountId: accountState.activeAccount?.id,
          ...(body as object),
        }),
      });
      if (
        response.ok &&
        response.headers?.get("content-type")?.includes("application/x-ndjson")
      ) {
        return await readExecutionStream(response, (event) => {
          const stages = ["extraction", "policy", "simulation", "broadcast"];
          const rank = (step: ExecutionProgress) => stages.indexOf(step.stage);
          // A stage that starts over clears itself and later stages, never earlier ones:
          // the policy check keeps the invoice reading that came before it.
          const previous = event.start
            ? progressRef.current.filter((s) => rank(s) < rank(event))
            : progressRef.current;
          progressRef.current = [
            ...previous.filter((s) => s.stage !== event.stage),
            event,
          ].sort((a, b) => rank(a) - rank(b));
          setProgress([...progressRef.current]);
        });
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      return data.result;
    } finally {
      try {
        await refresh();
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }

  // Every intent and approval lands in the conversation as a readable reply.
  async function converse(intent: string, body: unknown) {
    if (inFlight.current) return;
    const message = { id: crypto.randomUUID(), intent, time: Date.now() };
    setActiveIntent(intent);
    progressRef.current = [];
    setProgress([]);
    setTrip(null);
    try {
      const result = await request(body);
      setTrip(blockedTrip(result));
      const status = messageStatus(describeResult(result));
      setMessages((current) => [
        ...current,
        { ...message, result, status, steps: [...progressRef.current] },
      ]);
    } catch (error) {
      const text = (error as Error).message;
      setTrip(refusalTrip(text));
      const status = messageStatus(describeError(text));
      setMessages((current) => [
        ...current,
        { ...message, error: text, status, steps: [...progressRef.current] },
      ]);
    } finally {
      setActiveIntent("");
      setProgress([]);
    }
  }

  async function send(text: string) {
    if (accountState.session.status === "LOCKED") {
      setNotice("Unlock an account from the account menu to continue.");
      return;
    }
    if (!text.trim()) return;
    await converse(text, { type: "intent", prompt: text });
  }

  async function decide(id: string, approve: boolean) {
    const pin = approve ? await askPin("Authorize transaction") : undefined;
    if (approve && pin === null) return;
    const proposal = pending.find((item) => item.id === id);
    const verb = approve ? "Approve" : "Reject";
    const intent = proposal
      ? `${verb} ${proposal.action.amount} ${proposal.action.token} to ${shortAddress(proposal.action.recipient)}`
      : `${verb} proposal`;
    await converse(intent, { type: "approval", id, approve, pin });
  }

  async function savePolicy(policy: Policy) {
    if (inFlight.current) return;
    const pin = await askPin("Confirm policy changes");
    if (pin === null) return;
    try {
      await request({
        type: "policy",
        pin,
        policy: {
          ...policy,
          whitelistedAddresses: policy.whitelistedAddresses
            .map((value) => value.trim())
            .filter(Boolean),
          blacklistedAddresses: policy.blacklistedAddresses
            .map((value) => value.trim())
            .filter(Boolean),
        },
      });
      setNotice("Permission policy saved.");
    } catch (error) {
      setNotice((error as Error).message);
    }
  }

  function askPin(title: string): Promise<string | null> {
    return new Promise((resolve) => setStepUp({ title, finish: resolve }));
  }

  async function changeAccount(
    body:
      | {
          type: "account_create";
          name: string;
          profile: RiskProfile;
          pin: string;
        }
      | { type: "account_switch"; id: string; pin: string },
  ) {
    await request(body);
    setMessages([]);
    setProgress([]);
    setTrip(null);
    setTab("command");
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
    accountState,
    stepUp,
    finishStepUp: (pin: string | null) => {
      stepUp?.finish(pin);
      setStepUp(null);
    },
    changeAccount,
    tab,
    setTab,
    busy: busy || Boolean(stepUp),
    authorizing: Boolean(stepUp),
    sessionLocked: accountState.session.status === "LOCKED",
    messages,
    progress,
    activeIntent,
    clearThread: () => {
      if (!inFlight.current) {
        setMessages([]);
        setProgress([]);
        setTrip(null);
      }
    },
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
    comparePolicy: (
      action: Action,
      limits: Pick<
        Policy,
        "tier1SingleTxMaxUsd" | "tier1DailyLimitUsd" | "requireApproval"
      >,
    ) =>
      request({
        type: "policy_compare",
        comparison: { action, limits },
      }) as Promise<PolicyComparison>,
    previewTreasury: (settings: MandateSettings) =>
      request({ type: "treasury_preview", settings }) as Promise<
        SweepCalculation & {
          id: string | null;
          expiresAt: number;
          policyHash: string;
          accountId: string;
        }
      >,
    executeTreasury: (id: string) =>
      converse("Execute the reviewed treasury mandate", {
        type: "treasury_execute",
        id,
      }),
  };
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const wallet = useWalletState();
  return (
    <WalletContext.Provider value={wallet}>
      {children}
      {wallet.stepUp && (
        <PinDialog
          title={wallet.stepUp.title}
          accountName={wallet.accountState.activeAccount?.name}
          demo={wallet.accountState.activeAccount?.id === "master"}
          onFinish={wallet.finishStepUp}
        />
      )}
    </WalletContext.Provider>
  );
}

export function useWallet(): Wallet {
  const wallet = useContext(WalletContext);
  if (!wallet) throw new Error("useWallet must be used inside WalletProvider");
  return wallet;
}
