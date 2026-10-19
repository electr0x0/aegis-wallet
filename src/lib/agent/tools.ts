import { randomUUID } from "node:crypto";
import { BaseError, formatUnits, isAddress, parseUnits } from "viem";
import { z } from "zod";
import {
  USDC,
  WETH,
  account,
  decodeGuardError,
  guardAddress,
  holderAddress,
  holderBalance,
  tokenDecimals,
  outerCall,
  portfolio,
  publicClient,
  signOwnerApproval,
  transaction,
  wallet,
  type OwnerApproval,
} from "../chain";
import { scanBytecode } from "../security/bytecode";
import {
  evaluateTransactionPolicy,
  explainDecision,
  type Action,
  type Decision,
  type Policy,
} from "../security/policyEngine";
import {
  exclusive,
  ledger,
  log,
  policy,
  policyHash,
  saveLedger,
  type Entry,
  type Ledger,
  type Proposal,
} from "../store";

const BASE_SEPOLIA_CHAIN_ID = 84532;
const ETH_REFERENCE_USD = 2500;
const DAY_MS = 86_400_000;
const RESERVED_STATUSES = ["BROADCASTING", "SUBMITTED", "CONFIRMED"];
const EIP1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

export const actionSchema = z.object({
  // Reads have their own tools; a "read" kind here would skip the write tiers.
  kind: z.enum(["wrap_eth", "unwrap_weth", "transfer_token"]),
  token: z.enum(["ETH", "WETH", "USDC"]),
  amount: z.string().regex(/^\d+(\.\d{1,18})?$/),
  recipient: z.string().refine(isAddress),
  prompt: z.string().max(4000),
});

type Inspection = {
  decision: Decision;
  usd: number;
  gasEstimate: string;
  error: string;
  rationale: string;
};
type NewEntry = Omit<Entry, "id" | "timestamp">;

function normalize(a: Action): Action {
  if (a.kind === "wrap_eth") return { ...a, recipient: WETH, token: "ETH" };
  if (a.kind === "unwrap_weth") return { ...a, recipient: WETH, token: "WETH" };
  return a;
}

function referenceUsd(a: Action): number {
  return Number(a.amount) * (a.token === "USDC" ? 1 : ETH_REFERENCE_USD);
}

function blocked(reason: string): Decision {
  return { tier: "BLOCKED", reasons: [reason], riskScore: 100 };
}

function includesAddress(list: string[], address: string): boolean {
  return list.some((x) => x.toLowerCase() === address.toLowerCase());
}

// Tier 1 spend still reserved in the rolling window. Unresolved broadcasts count.
// Tier 2 spend is explicitly authorized and excluded from the autonomous budget.
function autonomousSpendUsd(l: Ledger): number {
  const latest = new Map<string, Entry>();
  for (const entry of l.logs) latest.set(entry.operationId ?? entry.id, entry);
  let total = 0;
  for (const entry of latest.values()) {
    const recent = Date.now() - Date.parse(entry.timestamp) < DAY_MS;
    const reserved = RESERVED_STATUSES.includes(entry.status);
    if (entry.tier === "TIER_1_AUTO" && reserved && recent) total += entry.usd;
  }
  return total;
}

// Simulates the inner call from the address that holds the funds (guard or EOA).
async function simulate(a: Action) {
  if ((await publicClient.getChainId()) !== BASE_SEPOLIA_CHAIN_ID) {
    throw new Error("RPC chain mismatch");
  }
  const inner = { ...transaction(a), account: holderAddress() };
  const [gas, price, call] = await Promise.all([
    publicClient.estimateGas(inner),
    publicClient.getGasPrice(),
    publicClient.call(inner),
  ]);
  const isToken = a.kind === "transfer_token" && a.token !== "ETH";
  if (isToken && (!call.data || BigInt(call.data) !== 1n)) {
    throw new Error("Token transfer did not return true");
  }
  return {
    gasEstimate: gas.toString(),
    gasGwei: Number(formatUnits(price, 9)),
  };
}

// One readable line instead of viem's multi-line dump (URL, request body, call arguments).
function briefError(e: unknown): string {
  if (!(e instanceof BaseError)) return (e as Error).message;
  // viem leaves shortMessage unset when it wraps a non-viem error.
  const short = e.shortMessage || e.message;
  const { details } = e;
  if (!details || short.includes(details)) return short;
  return `${short} ${details}`;
}

// The commonest pre-flight failure is a holder without enough funds: name the shortfall.
async function simulationFailure(a: Action, e: unknown): Promise<string> {
  try {
    const decimals = tokenDecimals(a.token);
    const held = await holderBalance(a.token);
    if (held < parseUnits(a.amount, decimals)) {
      const balance = formatUnits(held, decimals);
      return `Insufficient ${a.token}: the wallet holds ${balance} ${a.token}, this needs ${a.amount} ${a.token}.`;
    }
  } catch {
    // The balance read is best effort; fall back to the RPC's own reason.
  }
  // Never empty: the policy treats an empty error as a passed simulation.
  return briefError(e) || "Pre-flight simulation failed";
}

async function holdingsUsd(a: Action, p: Policy) {
  if (a.kind !== "transfer_token" || !p.treasury) return undefined;
  return (await portfolio()).totalUsd;
}

// Second, independent layer: the on-chain session limits must also accept the call.
async function guardRejection(a: Action, approval?: OwnerApproval) {
  if (!guardAddress()) return null;
  try {
    const call = outerCall(transaction(a), approval);
    await publicClient.estimateGas({ ...call, account: account() });
    return null;
  } catch (e) {
    return (
      decodeGuardError(e) ??
      `On-chain guard pre-flight failed: ${briefError(e)}`
    );
  }
}

async function inspect(
  a: Action,
  l: Ledger,
  p: Policy,
  approved: boolean,
): Promise<Inspection> {
  const usd = referenceUsd(a);
  const spentUsd = autonomousSpendUsd(l);
  const finish = (
    decision: Decision,
    gasEstimate: string,
    error: string,
  ): Inspection => ({
    decision,
    usd,
    gasEstimate,
    error,
    rationale: explainDecision(a, decision, {
      usd,
      spentUsd,
      policy: p,
      simulation: !error,
    }),
  });

  // Tokens sent to a token contract are burned, whatever the whitelist says.
  if (
    a.kind === "transfer_token" &&
    includesAddress([WETH, USDC], a.recipient)
  ) {
    const decision = blocked(
      "Token contracts are not valid transfer recipients",
    );
    return finish(decision, "0", "Blocked before RPC");
  }

  const early = evaluateTransactionPolicy(a, p, {
    usd,
    spentUsd,
    gasGwei: 0,
    simulation: true,
  });
  if (early.tier === "BLOCKED") return finish(early, "0", "Blocked before RPC");

  let gasEstimate = "0";
  let gasGwei = 0;
  let holdings: number | undefined;
  let error = "";
  try {
    ({ gasEstimate, gasGwei } = await simulate(a));
    holdings = await holdingsUsd(a, p);
  } catch (e) {
    error = await simulationFailure(a, e);
  }

  let decision = evaluateTransactionPolicy(a, p, {
    usd,
    spentUsd,
    gasGwei,
    simulation: !error,
    holdingsUsd: holdings,
  });
  if (decision.tier === "TIER_1_AUTO" && !approved) {
    const rejection = await guardRejection(a);
    if (rejection) decision = blocked(rejection);
  }
  return finish(decision, gasEstimate, error);
}

function baseEntry(a: Action, check: Inspection, p: Policy): NewEntry {
  return {
    intent: a.prompt,
    tier: check.decision.tier,
    status: "PENDING",
    simulation: check.error || "PASSED",
    gasEstimate: check.gasEstimate,
    reasons: check.decision.reasons,
    riskScore: check.decision.riskScore,
    usd: check.usd,
    rationale: check.rationale,
    policyHash: policyHash(p),
  };
}

async function record<T>(l: Ledger, entry: NewEntry, result: T): Promise<T> {
  log(l, entry);
  await saveLedger(l);
  return result;
}

async function broadcast(
  l: Ledger,
  a: Action,
  check: Inspection,
  base: NewEntry,
  proposal?: Proposal,
) {
  // A human approval in guard mode becomes an owner signature the contract verifies.
  let approval: OwnerApproval | undefined;
  if (proposal && guardAddress()) {
    let rejection: string | null;
    try {
      approval = await signOwnerApproval(transaction(a));
      rejection = await guardRejection(a, approval);
    } catch (e) {
      rejection = `Owner approval failed: ${briefError(e)}`;
    }
    if (rejection) {
      proposal.status = "BLOCKED";
      const rationale = `BLOCKED at approval: ${rejection}. No transaction was broadcast.`;
      const result = { ...check, decision: blocked(rejection), rationale };
      const entry: NewEntry = {
        ...base,
        tier: "BLOCKED",
        status: "BLOCKED",
        reasons: [rejection],
        riskScore: 100,
        rationale,
      };
      return record(l, entry, result);
    }
  }

  const reasons = approval
    ? [...base.reasons, "Executed with owner-signed approval via AgentGuard"]
    : base.reasons;
  const entry: NewEntry = {
    ...base,
    reasons,
    operationId: randomUUID(),
    tier: proposal ? "TIER_2_HITL" : base.tier,
    status: "BROADCASTING",
  };
  // Persist a reservation before any broadcast. Unknown outcomes require manual reconciliation.
  if (proposal) proposal.status = "BROADCASTING";
  log(l, entry);
  await saveLedger(l);

  try {
    const hash = await wallet().sendTransaction(
      outerCall(transaction(a), approval),
    );
    entry.txHash = hash;
    entry.status = "SUBMITTED";
    if (proposal) proposal.status = "SUBMITTED";
    log(l, entry);
    await saveLedger(l);

    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      timeout: 60_000,
    });
    entry.status = receipt.status === "success" ? "CONFIRMED" : "REVERTED";
    if (proposal) proposal.status = entry.status;
    return record(l, entry, { ...check, txHash: hash, status: entry.status });
  } catch (e) {
    entry.reasons = [...entry.reasons, briefError(e)];
    log(l, entry);
    await saveLedger(l);
    throw new Error(
      entry.txHash
        ? `Transaction submitted: ${entry.txHash}. Receipt pending; do not retry.`
        : "Broadcast outcome unresolved. Inspect the wallet before retrying.",
    );
  }
}

export async function executeAction(
  input: Action,
  dryRun = false,
  approvalId?: string,
) {
  return exclusive(async () => {
    const a = normalize(actionSchema.parse(input));
    const l = await ledger();
    const proposal = approvalId
      ? l.pending.find(
          (p) => p.id === approvalId && p.status === "AWAITING_HITL_APPROVAL",
        )
      : undefined;
    if (approvalId && !proposal)
      throw new Error("Proposal already handled or missing");

    const p = await policy();
    const check = await inspect(a, l, p, Boolean(proposal));
    const base = baseEntry(a, check, p);

    if (dryRun) return record(l, { ...base, status: "DRY_RUN" }, check);
    if (check.decision.tier === "BLOCKED") {
      if (proposal) proposal.status = "BLOCKED";
      return record(l, { ...base, status: "BLOCKED" }, check);
    }
    if (check.decision.tier === "TIER_2_HITL" && !proposal) {
      const id = randomUUID();
      l.pending.push({
        id,
        action: a,
        decision: check.decision,
        usd: check.usd,
        gasEstimate: check.gasEstimate,
        status: "AWAITING_HITL_APPROVAL",
        rationale: check.rationale,
      });
      return record(
        l,
        { ...base, status: "AWAITING_HITL_APPROVAL" },
        { ...check, proposalId: id },
      );
    }
    // Only Tier 1 or an operator-approved proposal may ever reach signing.
    if (check.decision.tier !== "TIER_1_AUTO" && !proposal) {
      throw new Error(`Refused: ${check.decision.tier} is not executable`);
    }
    return broadcast(l, a, check, base, proposal);
  });
}

export async function decide(id: string, approve: boolean) {
  const found = (await ledger()).pending.find((x) => x.id === id);
  if (!found) throw new Error("Proposal not found");
  if (approve) return executeAction(found.action, false, id);

  return exclusive(async () => {
    const l = await ledger();
    const current = l.pending.find((x) => x.id === id);
    if (!current || current.status !== "AWAITING_HITL_APPROVAL") {
      throw new Error("Proposal already handled");
    }
    current.status = "REJECTED";
    const entry: NewEntry = {
      intent: current.action.prompt,
      tier: "TIER_2_HITL",
      status: "REJECTED",
      simulation: "PASSED",
      reasons: ["Rejected by operator"],
      riskScore: 65,
      usd: current.usd,
      rationale: "Operator rejected the Tier 2 proposal. Nothing was signed.",
    };
    return record(l, entry, { status: "REJECTED" });
  });
}

export async function get_wallet_portfolio(prompt: string) {
  const result = await portfolio();
  await exclusive(async () => {
    const l = await ledger();
    const entry: NewEntry = {
      intent: prompt,
      tier: "TIER_0",
      status: "COMPLETED",
      simulation: "READ_ONLY",
      reasons: ["Live RPC portfolio read"],
      riskScore: 0,
      usd: 0,
      rationale: `TIER_0: read-only portfolio of ${result.holder} (${result.mode} mode). No signing.`,
    };
    await record(l, entry, null);
  });
  return result;
}

export async function audit_contract_address(address: string) {
  if (!isAddress(address)) throw new Error("Invalid address");
  const p = await policy();
  const [code, slot] = await Promise.all([
    publicClient.getCode({ address }),
    publicClient.getStorageAt({ address, slot: EIP1967_IMPLEMENTATION_SLOT }),
  ]);
  const scan = scanBytecode(code);
  const implementation =
    slot && BigInt(slot) !== 0n ? `0x${slot.slice(-40)}` : undefined;
  const flags = implementation
    ? [...scan.flags, `EIP-1967 proxy → ${implementation}`]
    : scan.flags;

  let riskScore = 60;
  if (scan.delegatecall) riskScore += 15;
  if (scan.selfdestruct) riskScore += 20;
  if (implementation) riskScore += 10;
  if (includesAddress(p.whitelistedAddresses, address)) riskScore = 10;
  if (includesAddress(p.blacklistedAddresses, address)) riskScore = 100;

  return {
    address,
    contract: scan.isContract,
    riskScore: Math.min(riskScore, 100),
    flags,
    implementation,
    warning: "Static bytecode heuristics are not a contract security audit.",
  };
}

export const simulate_transaction = (a: Action) => executeAction(a, true);
export const execute_token_transfer = executeAction;

export async function execute_eth_weth_rebalance(
  targetWethRatio: number,
  prompt: string,
) {
  if (!(targetWethRatio >= 0 && targetWethRatio <= 1)) {
    throw new Error("Ratio must be between 0 and 1");
  }
  const { balances } = await portfolio();
  const eth = Number(balances.ETH);
  const weth = Number(balances.WETH);
  const delta = (eth + weth) * targetWethRatio - weth;
  return executeAction({
    kind: delta >= 0 ? "wrap_eth" : "unwrap_weth",
    token: delta >= 0 ? "ETH" : "WETH",
    amount: Math.abs(delta).toFixed(18),
    recipient: WETH,
    prompt,
  });
}
