import type { Policy } from "@/lib/security/policyEngine";
import type { Ledger } from "@/lib/store";

export type LivePortfolio = {
  address: string;
  vault: string | null;
  balances: Record<string, string>;
  gasGwei: number;
  totalUsd: number;
};
export type Snapshot = {
  ledger: Ledger;
  policy: Policy;
  portfolio: LivePortfolio | null;
  error: string;
};
export type AgentMessage = {
  id: string;
  intent: string;
  result: string;
  status: "success" | "error" | "pending";
};
export const shortAddress = (address: string) =>
  `${address.slice(0, 8)}…${address.slice(-6)}`;
