"use client";

import {
  AlertTriangle,
  Check,
  Clock,
  ExternalLink,
  Info,
} from "@/components/wallet/icons";
import {
  EXPLORER,
  formatUsd,
  shortAddress,
  type AgentMessage,
  type LivePortfolio,
} from "./types";

type Tone = "success" | "pending" | "error" | "info";
export type Reply = {
  tone: Tone;
  title: string;
  detail?: string;
  facts?: [label: string, value: string][];
  txHash?: string;
  note?: string;
  steps?: Reply[];
};

type Execution = {
  decision: { tier: string; reasons: string[]; riskScore: number };
  usd: number;
  gasEstimate: string;
  error: string;
  rationale: string;
  txHash?: string;
  status?: string;
};
type Audit = {
  address: string;
  contract: boolean;
  riskScore: number;
  flags: string[];
  warning: string;
};
type Plan = { summary: string; results: unknown[] };

const REFUSAL = /\brefus|\bnot supported\b/i;
const PRE_RPC = "Blocked before RPC";

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object";

const amount = (value: string) =>
  Number(value).toLocaleString("en-US", { maximumFractionDigits: 6 });

// "TIER_1_AUTO: wrap 0.001 ETH (~$2.50). Within…" reads better without the tier code.
function plainRationale(rationale: string) {
  const text = rationale.replace(/^[A-Z0-9_]+: /, "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function executionFacts(x: Execution): Reply["facts"] {
  const facts: [string, string][] = [
    ["Reference value", formatUsd(x.usd)],
    ["Risk score", `${x.decision.riskScore} / 100`],
  ];
  if (x.gasEstimate !== "0") {
    facts.push([
      "Gas estimate",
      `${Number(x.gasEstimate).toLocaleString()} units`,
    ]);
  }
  return facts;
}

function describeBlock(x: Execution): Reply {
  const reasons = x.decision.reasons.join("; ");
  const cause = x.error && x.error !== PRE_RPC ? x.error : "";
  const shortfall = cause.startsWith("Insufficient ");
  return {
    tone: "error",
    title: "Blocked. Nothing was signed.",
    detail:
      cause && !reasons.includes(cause) ? `${reasons}. ${cause}` : reasons,
    facts: executionFacts(x),
    note: shortfall ? "Fund the wallet or try a smaller amount." : undefined,
  };
}

function describeExecution(x: Execution): Reply {
  const approved = x.decision.tier === "TIER_2_HITL";
  if (x.txHash) {
    if (x.status === "REVERTED") {
      return {
        tone: "error",
        title: "The transaction reverted on-chain",
        detail: "It was mined but failed, so only gas was spent.",
        txHash: x.txHash,
      };
    }
    const confirmed = x.status === "CONFIRMED";
    return {
      tone: confirmed ? "success" : "pending",
      title: confirmed
        ? approved
          ? "Approved and confirmed on Base Sepolia"
          : "Done. Confirmed on Base Sepolia."
        : "Submitted. Waiting for the receipt.",
      detail: plainRationale(x.rationale),
      facts: executionFacts(x),
      txHash: x.txHash,
    };
  }
  if (x.decision.tier === "BLOCKED") return describeBlock(x);
  if (approved) {
    return {
      tone: "pending",
      title: "Waiting for your approval",
      detail: x.decision.reasons.join("; "),
      facts: executionFacts(x),
      note: "Review the proposal below. Nothing is signed until you approve it.",
    };
  }
  // A Tier 1 result without a hash is a dry run: execution always broadcasts.
  return {
    tone: "success",
    title: "Simulation passed. Nothing was signed.",
    detail: plainRationale(x.rationale),
    facts: executionFacts(x),
  };
}

function describePortfolio(p: LivePortfolio): Reply {
  const holder = p.mode === "guard" ? "The AgentGuard contract" : "The wallet";
  const facts: [string, string][] = ["ETH", "WETH", "USDC"].map((token) => [
    token,
    amount(p.balances[token] ?? "0"),
  ]);
  facts.push(["Network gas", `${p.gasGwei.toFixed(4)} gwei`]);
  if (p.agentGasEth !== undefined) {
    facts.push(["Agent gas balance", `${amount(p.agentGasEth)} ETH`]);
  }
  return {
    tone: "info",
    title: "Here is your wallet",
    detail: `${holder} at ${shortAddress(p.address)} holds ${formatUsd(p.totalUsd)} at reference prices. Read only, nothing was signed.`,
    facts,
  };
}

function describeAudit(a: Audit): Reply {
  const tone =
    a.riskScore >= 70 ? "error" : a.riskScore >= 40 ? "pending" : "success";
  return {
    tone,
    title: `Address risk ${a.riskScore} / 100`,
    detail: a.contract
      ? `${shortAddress(a.address)} is a contract.`
      : `${shortAddress(a.address)} is a regular account with no contract code.`,
    facts: a.flags.map((flag): [string, string] => ["Finding", flag]),
    note: a.warning,
  };
}

const PLAN_STOPS: Record<string, string> = {
  "Planner stopped: TIER_2_HITL": "Stopped to wait for your approval.",
  "Planner stopped: BLOCKED": "Stopped at a blocked step.",
  "Planner stopped: transaction broadcast":
    "Stopped after one broadcast, so nothing runs twice.",
};

function describePlan(plan: Plan): Reply {
  const steps = plan.results.map(describeResult);
  const tone =
    steps.find((s) => s.tone === "error")?.tone ??
    steps.find((s) => s.tone === "pending")?.tone ??
    "success";
  const count = steps.length;
  return {
    tone,
    title: count
      ? `Ran ${count} step${count === 1 ? "" : "s"}`
      : "The agent answered",
    detail: PLAN_STOPS[plan.summary] ?? plan.summary,
    steps,
  };
}

export function describeResult(result: unknown): Reply {
  if (isObject(result)) {
    if (Array.isArray(result.results)) return describePlan(result as Plan);
    if (isObject(result.decision))
      return describeExecution(result as Execution);
    if (isObject(result.balances)) {
      return describePortfolio(result as LivePortfolio);
    }
    if (Array.isArray(result.flags)) return describeAudit(result as Audit);
    if (result.status === "REJECTED") {
      return { tone: "info", title: "Proposal rejected. Nothing was signed." };
    }
  }
  return { tone: "info", title: "Done" };
}

export function describeError(message: string): Reply {
  return {
    tone: "error",
    title: REFUSAL.test(message)
      ? "Refused. Nothing was signed."
      : "That request did not run",
    detail: message,
  };
}

export function messageStatus(reply: Reply): AgentMessage["status"] {
  if (reply.tone === "error") return "error";
  return reply.tone === "pending" ? "pending" : "success";
}

const TONE_ICON = {
  success: Check,
  pending: Clock,
  error: AlertTriangle,
  info: Info,
};

export function AgentReply({ reply, raw }: { reply: Reply; raw?: unknown }) {
  const Icon = TONE_ICON[reply.tone];
  return (
    <div className="agent-reply" data-tone={reply.tone}>
      <p className="agent-reply-title">
        <Icon size={15} />
        {reply.title}
      </p>
      {reply.detail && <p className="agent-reply-detail">{reply.detail}</p>}
      {reply.facts && reply.facts.length > 0 && (
        <dl className="agent-reply-facts">
          {reply.facts.map(([label, value], index) => (
            <div key={`${label}-${index}`}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {reply.txHash && (
        <a
          className="transaction-link"
          href={`${EXPLORER}/tx/${reply.txHash}`}
          target="_blank"
          rel="noreferrer"
          title={reply.txHash}
        >
          View on BaseScan · {shortAddress(reply.txHash)}
          <ExternalLink size={12} />
        </a>
      )}
      {reply.note && <p className="agent-reply-note">{reply.note}</p>}
      {reply.steps?.map((step, index) => (
        <div className="agent-reply-step" key={index}>
          <AgentReply reply={step} />
        </div>
      ))}
      {raw !== undefined && (
        <details className="agent-reply-raw">
          <summary>Technical details</summary>
          <pre>{JSON.stringify(raw, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}
