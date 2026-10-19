import type { Policy } from "@/lib/security/policyEngine";
import type { Entry, LedgerVerification, Proposal } from "@/lib/store";

export const EXPLORER = "https://sepolia.basescan.org";

// Client view of the GET /api/agent payload. Fields added for the guard and the
// sealed ledger are optional so the dashboard renders against older backends.
export type GuardLimit = {
  asset: "ETH" | "WETH" | "USDC";
  perTx: string;
  perDay: string;
  spentToday: string;
};
export type GuardStatus = {
  address: string;
  owner: string;
  sessionKey: string;
  sessionExpiry: number;
  limits: GuardLimit[];
};
export type LivePortfolio = {
  address: string;
  holder?: string;
  agent?: string;
  mode?: "guard" | "eoa";
  vault: string | null;
  balances: Record<string, string>;
  agentGasEth?: string;
  gasGwei: number;
  totalUsd: number;
};
export type ProposalView = Proposal & { rationale?: string };
export type Snapshot = {
  ledger: { logs: Entry[]; pending: ProposalView[] };
  policy: Policy;
  portfolio: LivePortfolio | null;
  error: string;
  guard?: GuardStatus | null;
  verification?: LedgerVerification;
};
export type AgentMessage = {
  id: string;
  intent: string;
  result: string;
  status: "success" | "error" | "pending";
};
export const shortAddress = (address: string) =>
  `${address.slice(0, 8)}…${address.slice(-6)}`;
export const formatUsd = (value: number) =>
  value.toLocaleString("en-US", { style: "currency", currency: "USD" });
