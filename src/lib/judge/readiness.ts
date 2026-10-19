import { parseUnits } from "viem";
import type { Snapshot } from "../../components/wallet/types";

export type ReadinessItem = {
  id: string;
  title: string;
  status: "ready" | "attention" | "unavailable";
  detail: string;
};
export function judgeReadiness(
  snapshot: Snapshot | null,
  now = Date.now(),
): ReadinessItem[] {
  if (!snapshot)
    return [
      {
        id: "connection",
        title: "Operator session",
        status: "unavailable",
        detail: "Unlock an account and wait for live data.",
      },
    ];
  const { portfolio: live, policy: p, guard, ledger: l } = snapshot;
  const same = (a?: string | null, b?: string | null) =>
    Boolean(a && b && a.toLowerCase() === b.toLowerCase());
  const trustedVault =
    live?.vault &&
    p.whitelistedAddresses.some((a) => same(a, live.vault)) &&
    !p.blacklistedAddresses.some((a) => same(a, live.vault));
  const activeGuard =
    guard &&
    live?.mode === "guard" &&
    same(guard.sessionKey, live.agent) &&
    guard.sessionExpiry * 1000 > now;
  const gas = live
    ? parseUnits(live.agentGasEth ?? live.balances.ETH ?? "0", 18)
    : null;
  const latest = [
    ...new Map(l.logs.map((e) => [e.operationId ?? e.id, e])).values(),
  ];
  const unresolved = latest.filter((e) =>
    ["BROADCASTING", "SUBMITTED"].includes(e.status),
  );
  const scenarios = [
    [
      "read",
      l.logs.some((e) => e.tier === "TIER_0" && e.status === "COMPLETED"),
    ],
    [
      "auto",
      l.logs.some((e) => e.tier === "TIER_1_AUTO" && e.status === "CONFIRMED"),
    ],
    [
      "HITL",
      l.logs.some((e) => e.tier === "TIER_2_HITL" && e.status === "CONFIRMED"),
    ],
    [
      "block",
      l.logs.some((e) => e.tier === "BLOCKED" && e.status === "BLOCKED"),
    ],
  ] as const;
  const missing = scenarios
    .filter(([, found]) => !found)
    .map(([label]) => label);
  return [
    {
      id: "planner",
      title: "Natural-language planner configuration",
      status: snapshot.planner?.length ? "ready" : "attention",
      detail: snapshot.planner?.length
        ? `${snapshot.planner.map((p) => `${p.name} / ${p.model}`).join(" → ")}. Configured; provider availability is not tested here.`
        : "No LLM key configured. Deterministic demo intents remain available; arbitrary natural language needs a provider.",
    },
    {
      id: "guard",
      title: "Independent on-chain custody",
      status: !live ? "unavailable" : activeGuard ? "ready" : "attention",
      detail: activeGuard
        ? `AgentGuard session matches the active signer until ${new Date(guard.sessionExpiry * 1000).toLocaleString()}.`
        : live?.mode === "guard"
          ? "Guard session is expired, revoked, mismatched or unreadable. Use operator verification before the demo."
          : "EOA mode: server policy applies; there is no independent contract custody for this account.",
    },
    {
      id: "gas",
      title: "Agent gas reserve",
      status:
        gas === null
          ? "unavailable"
          : gas >= parseUnits("0.0003", 18)
            ? "ready"
            : "attention",
      detail:
        gas === null
          ? "Live RPC balances unavailable."
          : `${live?.agentGasEth ?? live?.balances.ETH ?? "0"} ETH for gas. Demo readiness threshold is 0.0003 ETH, not a fee guarantee.`,
    },
    {
      id: "vault",
      title: "Treasury destination",
      status: !live ? "unavailable" : trustedVault ? "ready" : "attention",
      detail: trustedVault
        ? "Configured vault is whitelisted and not blacklisted."
        : "Configure a vault and its recipient policy before demonstrating treasury sweeps.",
    },
    {
      id: "tiers",
      title: "Autonomous demonstration policy",
      status:
        !p.executionPaused &&
        !p.requireApproval &&
        p.tier1SingleTxMaxUsd > 0 &&
        p.tier1DailyLimitUsd > 0
          ? "ready"
          : "attention",
      detail: p.executionPaused
        ? "Local writes are paused. Resume requires the operator PIN."
        : p.requireApproval
          ? "Always ask is enabled: Tier 1-sized writes still require approval. Policy changes require the operator PIN."
          : "Autonomous caps are active. Simulation, current budget, recipient and guard checks still decide each request.",
    },
    {
      id: "seals",
      title: "Local ledger integrity",
      status: !snapshot.verification
        ? "unavailable"
        : snapshot.verification.valid && snapshot.verification.entries > 0
          ? "ready"
          : "attention",
      detail: snapshot.verification
        ? `${snapshot.verification.sealed}/${snapshot.verification.entries} sealed entries; ${snapshot.verification.valid ? "local verifier passes" : (snapshot.verification.reason ?? "verification failed")}. Check the export independently below.`
        : "No verification result available.",
    },
    {
      id: "scenarios",
      title: "Recorded permission-tier coverage",
      status: missing.length ? "attention" : "ready",
      detail: missing.length
        ? `This account has no completed example for: ${missing.join(", ")}. Existing entries are records, not independent receipt verification.`
        : "Read, autonomous, HITL and hard-block examples are recorded. Verify their receipts below before citing them.",
    },
    {
      id: "outcomes",
      title: "Broadcast reconciliation",
      status: unresolved.length ? "attention" : "ready",
      detail: unresolved.length
        ? `${unresolved.length} latest operations remain submitted or broadcasting. Reconcile on BaseScan; do not retry automatically.`
        : "No unresolved broadcasts recorded for this account.",
    },
  ];
}
