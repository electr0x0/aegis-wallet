import { randomUUID } from "node:crypto";
import { reportProgress } from "./progress";
import {
  calculateSweep,
  spentUnits,
  type TreasuryConstraint,
} from "../treasury/calculate";
import { BaseError, formatUnits, isAddress, parseUnits, zeroHash } from "viem";
import { z } from "zod";
import {
  USDC,
  WETH,
  account,
  anchorCall,
  attestationUid,
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
  belongsToAccount,
  currentAccount,
  currentAccountId,
} from "../auth/context";
import {
  claimDrip,
  DripAlreadyClaimedError,
  requireStepUp,
  setDrip,
  withMasterFunding,
} from "../auth/accountStore";
import type { PublicAccount } from "../auth/accountStore";
import {
  ANCHOR_KINDS,
  EAS_ADDRESS,
  SCHEMA_REGISTRY_ADDRESS,
  evaluateTransactionPolicy,
  explainDecision,
  isAnchor,
  type Action,
  type AnchorKind,
  type Decision,
  type LedgerAnchor,
  type Policy,
  type PolicyContext,
} from "../security/policyEngine";
import {
  exclusive,
  ledger,
  log,
  policy,
  policyHash,
  saveLedger,
  verifyLedger,
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
  kind: z.enum(["wrap_eth", "unwrap_weth", "transfer_token", "fund_account"]),
  token: z.enum(["ETH", "WETH", "USDC"]),
  amount: z.string().regex(/^\d+(\.\d{1,18})?$/),
  recipient: z.string().refine(isAddress),
  prompt: z.string().max(4000),
});

// Operator-only (pnpm ledger:anchor). Planner and approval inputs parse with
// actionSchema, which never accepts these kinds.
const anchorSchema = actionSchema.extend({ kind: z.enum(ANCHOR_KINDS) });
const ANCHOR_PROMPTS: Record<AnchorKind, string> = {
  register_anchor_schema: "LEDGER_ANCHOR_SCHEMA",
  anchor_ledger: "LEDGER_ANCHOR",
};

type Inspection = {
  context: PolicyContext;
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
    if (!belongsToAccount(entry)) continue;
    const recent = Date.now() - Date.parse(entry.timestamp) < DAY_MS;
    const reserved = RESERVED_STATUSES.includes(entry.status);
    if (entry.tier === "TIER_1_AUTO" && reserved && recent) total += entry.usd;
  }
  return total;
}

// An anchor whose outcome is unknown stays reserved: no second anchor while it is open
// (24 hours, the same window Tier 1 reservations hold budget for).
function unresolvedAnchor(l: Ledger): boolean {
  const latest = new Map<string, Entry>();
  for (const entry of l.logs) latest.set(entry.operationId ?? entry.id, entry);
  const prompts = Object.values(ANCHOR_PROMPTS);
  return [...latest.values()].some(
    (entry) =>
      prompts.includes(entry.intent) &&
      ["BROADCASTING", "SUBMITTED"].includes(entry.status) &&
      Date.now() - Date.parse(entry.timestamp) < DAY_MS,
  );
}

// The anchored data comes only from the sealed ledger and the current policy.
async function ledgerHead(l: Ledger, p: Policy): Promise<LedgerAnchor> {
  if (!(await verifyLedger(l)).valid) {
    throw new Error("Ledger fails verification; refusing to anchor it.");
  }
  if (unresolvedAnchor(l)) {
    throw new Error(
      "A previous ledger anchor is unresolved. Check it on BaseScan; do not retry.",
    );
  }
  return {
    ledgerHead: l.logs.at(-1)?.hash ?? zeroHash,
    entryCount: l.logs.length,
    policyHash: policyHash(p),
  };
}

// Simulates the inner call from the address that holds the funds (guard or EOA).
// Ledger anchors are sent by the agent EOA itself, so they simulate from it.
async function simulate(a: Action) {
  if ((await publicClient.getChainId()) !== BASE_SEPOLIA_CHAIN_ID) {
    throw new Error("RPC chain mismatch");
  }
  const from = isAnchor(a) ? account().address : holderAddress();
  const inner = { ...transaction(a), account: from };
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
  if (!["transfer_token", "fund_account"].includes(a.kind) || !p.treasury)
    return undefined;
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
  onboardingRecipient?: string,
): Promise<Inspection> {
  reportProgress({
    stage: "policy",
    status: "running",
    message: "Checking deterministic limits and recipient rules.",
    start: true,
  });
  const usd = referenceUsd(a);
  const spentUsd = autonomousSpendUsd(l);
  let gasGwei = 0;
  let holdings: number | undefined;
  const finish = (
    decision: Decision,
    gasEstimate: string,
    error: string,
  ): Inspection => {
    reportProgress({
      stage: "policy",
      status:
        decision.tier === "BLOCKED"
          ? "failed"
          : decision.tier === "TIER_2_HITL"
            ? "held"
            : "success",
      message: `${decision.tier}: ${decision.reasons.join("; ")}`,
    });
    return {
      context: {
        usd,
        spentUsd,
        gasGwei,
        simulation: !error,
        holdingsUsd: holdings,
      },
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
    };
  };

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

  // The policy checks an anchor against the calldata that will actually be signed.
  const anchor = isAnchor(a) ? anchorCall(transaction(a)) : undefined;
  const early = evaluateTransactionPolicy(a, p, {
    usd,
    spentUsd,
    gasGwei: 0,
    simulation: true,
    onboardingRecipient,
    anchorCall: anchor,
  });
  if (early.tier === "BLOCKED") return finish(early, "0", "Blocked before RPC");

  let gasEstimate = "0";
  let error = "";
  reportProgress({
    stage: "simulation",
    status: "running",
    message:
      "Checking chain 84532, estimating gas and simulating the exact call.",
  });
  try {
    ({ gasEstimate, gasGwei } = await simulate(a));
    holdings = await holdingsUsd(a, p);
    reportProgress({
      stage: "simulation",
      status: "success",
      message: `Pre-flight passed. Estimated ${gasEstimate} gas units.`,
    });
  } catch (e) {
    error = await simulationFailure(a, e);
    reportProgress({ stage: "simulation", status: "failed", message: error });
  }

  let decision = evaluateTransactionPolicy(a, p, {
    usd,
    spentUsd,
    gasGwei,
    simulation: !error,
    holdingsUsd: holdings,
    onboardingRecipient,
    anchorCall: anchor,
  });
  // Anchors never pass through AgentGuard (see broadcast), so there is no guard pre-flight.
  if (decision.tier === "TIER_1_AUTO" && !approved && !isAnchor(a)) {
    const rejection = await guardRejection(a);
    if (rejection) decision = blocked(rejection);
  }
  return finish(decision, gasEstimate, error);
}

export const policyComparisonSchema = z.object({
  action: actionSchema.extend({
    kind: z.enum(["wrap_eth", "unwrap_weth", "transfer_token"]),
  }),
  limits: z
    .object({
      tier1SingleTxMaxUsd: z.number().min(0).max(10000),
      tier1DailyLimitUsd: z.number().min(0).max(10000),
      requireApproval: z.boolean(),
    })
    .strict(),
});

// Read-only: reuses the execution inspector but never creates a proposal, reserves or signs.
export async function comparePolicy(input: unknown) {
  const { action, limits } = policyComparisonSchema.parse(input);
  const a = normalize(action);
  const [l, p] = await Promise.all([ledger(), policy()]);
  const current = await inspect(a, l, p, false);
  const hypotheticalPolicy = { ...p, ...limits };
  let hypothetical =
    current.decision.tier === "BLOCKED"
      ? current.decision
      : evaluateTransactionPolicy(a, hypotheticalPolicy, current.context);
  // A looser server cap never removes the separate contract's limits.
  if (
    hypothetical.tier === "TIER_1_AUTO" &&
    current.decision.tier !== "TIER_1_AUTO"
  ) {
    const rejection = await guardRejection(a);
    if (rejection) hypothetical = blocked(rejection);
  }
  return {
    action: a,
    current: { decision: current.decision, rationale: current.rationale },
    hypothetical: {
      decision: hypothetical,
      rationale: explainDecision(a, hypothetical, {
        usd: current.usd,
        spentUsd: current.context.spentUsd,
        policy: hypotheticalPolicy,
        simulation: current.context.simulation,
      }),
    },
    simulation: current.error || "PASSED",
    gasEstimate: current.gasEstimate,
    policyHash: policyHash(p),
    comparedAt: new Date().toISOString(),
  };
}
export type PolicyComparison = Awaited<ReturnType<typeof comparePolicy>>;

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
      reportProgress({ stage: "policy", status: "failed", message: rejection });
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
    reportProgress({
      stage: "broadcast",
      status: "running",
      message:
        "Spend reservation persisted. Submitting the signed transaction.",
    });
    // AgentGuard's target allowlist excludes EAS, so guard.execute would revert. A ledger
    // anchor goes straight from the agent EOA; the policy has proven it carries zero value.
    const call = isAnchor(a)
      ? transaction(a)
      : outerCall(transaction(a), approval);
    const hash = await wallet().sendTransaction(call);
    entry.txHash = hash;
    entry.status = "SUBMITTED";
    if (proposal) proposal.status = "SUBMITTED";
    log(l, entry);
    await saveLedger(l);
    reportProgress({
      stage: "broadcast",
      status: "submitted",
      message:
        "Transaction hash persisted. Waiting for the Base Sepolia receipt.",
      txHash: hash,
    });

    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      timeout: 60_000,
    });
    entry.status = receipt.status === "success" ? "CONFIRMED" : "REVERTED";
    if (proposal) proposal.status = entry.status;
    reportProgress({
      stage: "broadcast",
      status: receipt.status === "success" ? "success" : "failed",
      message:
        receipt.status === "success"
          ? "Successful receipt observed on Base Sepolia."
          : "Transaction mined but reverted.",
      txHash: hash,
    });
    const uid =
      a.kind === "anchor_ledger" ? attestationUid(receipt.logs) : undefined;
    if (uid) entry.reasons = [...entry.reasons, `EAS attestation UID ${uid}`];
    const result = { ...check, txHash: hash, status: entry.status };
    return record(l, entry, uid ? { ...result, attestationUid: uid } : result);
  } catch (e) {
    entry.reasons = [...entry.reasons, briefError(e)];
    log(l, entry);
    await saveLedger(l);
    reportProgress({
      stage: "broadcast",
      status: entry.txHash ? "submitted" : "failed",
      message: entry.txHash
        ? "Hash recorded; receipt pending. Do not retry."
        : "Broadcast outcome unresolved. Inspect the wallet before retrying.",
      txHash: entry.txHash,
    });
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
  pin?: string,
  operatorAnchor = false,
  mandate?: TreasuryConstraint,
) {
  return exclusive(async () => {
    const schema = operatorAnchor ? anchorSchema : actionSchema;
    let a = normalize(schema.parse(input));
    if (operatorAnchor && approvalId) {
      throw new Error("Ledger anchors are never proposals");
    }
    let onboardingRecipient: string | undefined;
    if (a.kind === "fund_account") {
      if (
        currentAccount()?.onboardingRecipient?.toLowerCase() !==
        a.recipient.toLowerCase()
      )
        throw new Error(
          "Onboarding transfers require a server provisioning context.",
        );
      if (dryRun || approvalId || a.token !== "ETH" || a.amount !== "0.0003")
        throw new Error("Invalid onboarding action");
      await claimDrip(a.recipient);
      onboardingRecipient = a.recipient;
      if (
        (await publicClient.getBalance({ address: account().address })) <=
        parseUnits("0.002", 18)
      )
        throw new Error(
          "Master gas reserve is at or below 0.002 ETH; fund this wallet manually.",
        );
    }
    const l = await ledger();
    const proposal = approvalId
      ? l.pending.find(
          (p) =>
            p.id === approvalId &&
            belongsToAccount(p) &&
            p.status === "AWAITING_HITL_APPROVAL",
        )
      : undefined;
    if (approvalId && !proposal)
      throw new Error("Proposal already handled or missing");
    if (proposal) {
      a = normalize(actionSchema.parse(proposal.action));
      await requireStepUp(pin, `APPROVAL:${proposal.id}`);
    }

    const p = await policy();
    // Auth logging writes the shared ledger. Reload it before any later save.
    const fresh = proposal ? await ledger() : l;
    const currentProposal = proposal
      ? fresh.pending.find((x) => x.id === proposal.id)!
      : undefined;
    if (isAnchor(a)) {
      // Any anchor field in the input was stripped by Zod; this one comes from the ledger.
      const head = await ledgerHead(fresh, p);
      if (a.kind === "anchor_ledger") a = { ...a, anchor: head };
    }
    const check = await inspect(
      a,
      fresh,
      p,
      Boolean(currentProposal),
      onboardingRecipient,
    );
    const constraint = currentProposal?.mandate ?? mandate;
    if (constraint && check.decision.tier !== "BLOCKED") {
      const violation = await mandateViolation(a, constraint, fresh, p);
      if (violation) {
        check.decision = blocked(violation);
        check.rationale = `BLOCKED: treasury mandate no longer holds. ${violation}. Nothing was signed.`;
        reportProgress({
          stage: "policy",
          status: "failed",
          message: violation,
        });
      }
    }
    const base = baseEntry(a, check, p);
    if (a.kind === "fund_account" && check.decision.tier !== "TIER_1_AUTO") {
      check.decision = blocked(
        `Onboarding requires autonomous authorization: ${check.decision.reasons.join("; ")}`,
      );
      return record(
        fresh,
        {
          ...base,
          tier: "BLOCKED",
          status: "BLOCKED",
          reasons: check.decision.reasons,
        },
        check,
      );
    }

    if (dryRun) return record(fresh, { ...base, status: "DRY_RUN" }, check);
    if (check.decision.tier === "BLOCKED") {
      if (currentProposal) currentProposal.status = "BLOCKED";
      return record(fresh, { ...base, status: "BLOCKED" }, check);
    }
    if (check.decision.tier === "TIER_2_HITL" && !proposal) {
      const id = randomUUID();
      fresh.pending.push({
        accountId: currentAccountId(),
        id,
        action: a,
        ...(constraint ? { mandate: constraint } : {}),
        decision: check.decision,
        usd: check.usd,
        gasEstimate: check.gasEstimate,
        status: "AWAITING_HITL_APPROVAL",
        rationale: check.rationale,
      });
      return record(
        fresh,
        { ...base, status: "AWAITING_HITL_APPROVAL" },
        { ...check, proposalId: id },
      );
    }
    // Only Tier 1 or an operator-approved proposal may ever reach signing.
    if (check.decision.tier !== "TIER_1_AUTO" && !proposal) {
      throw new Error(`Refused: ${check.decision.tier} is not executable`);
    }
    return broadcast(fresh, a, check, base, currentProposal);
  });
}

// Runs under executeAction's mutex, including when a held proposal is approved later.
async function mandateViolation(
  a: Action,
  constraint: TreasuryConstraint,
  l: Ledger,
  p: Policy,
) {
  if (Date.now() > constraint.expiresAt)
    return "Treasury preview expired; create a fresh preview";
  if (policyHash(p) !== constraint.policyHash)
    return "Policy changed after the treasury preview";
  try {
    const result = calculateSweep(
      constraint.settings,
      await portfolio(),
      p,
      spentUnits(l.logs, currentAccountId()),
    );
    const allowed = result.action;
    if (!allowed) return result.reasons.join(" ");
    if (
      a.kind !== "transfer_token" ||
      a.token !== allowed.token ||
      a.recipient.toLowerCase() !== allowed.recipient.toLowerCase()
    )
      return "Treasury action no longer matches the vault or selected asset";
    if (
      parseUnits(a.amount, tokenDecimals(a.token)) >
      parseUnits(allowed.amount, tokenDecimals(a.token))
    )
      return "Available balance, gas reserve, budget or runway surplus decreased";
    return null;
  } catch {
    return "Live treasury constraints could not be verified; preview again";
  }
}

export async function decide(id: string, approve: boolean, pin?: string) {
  const found = (await ledger()).pending.find(
    (x) => x.id === id && belongsToAccount(x),
  );
  if (!found) throw new Error("Proposal not found");
  if (approve) return executeAction(found.action, false, id, pin);

  return exclusive(async () => {
    const l = await ledger();
    const current = l.pending.find((x) => x.id === id && belongsToAccount(x));
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
  reportProgress({
    stage: "policy",
    status: "success",
    message: "Tier 0 read-only portfolio request. No transaction signing.",
    start: true,
  });
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

/**
 * Operator-only (pnpm ledger:anchor), never a planner tool: a fixed zero-value EAS call
 * through the same policy, simulation and reservation path as every other write.
 */
export function anchorLedger(kind: AnchorKind, dryRun = false) {
  const action: Action = {
    kind,
    token: "ETH",
    amount: "0",
    recipient: kind === "anchor_ledger" ? EAS_ADDRESS : SCHEMA_REGISTRY_ADDRESS,
    prompt: ANCHOR_PROMPTS[kind],
  };
  return executeAction(action, dryRun, undefined, undefined, true);
}

export const simulate_transaction = (a: Action) => executeAction(a, true);
export const execute_token_transfer = executeAction;

/** A bounded native-ETH transfer using the same reservation and signing path. */
export async function autoDrip(a: PublicAccount) {
  return withMasterFunding(async () => {
    try {
      const result = await executeAction({
        kind: "fund_account",
        token: "ETH",
        amount: "0.0003",
        recipient: a.address,
        prompt: `ONBOARDING_GAS_DRIP:${a.id}`,
      });
      const sent = result as typeof result & {
        txHash?: string;
        status?: "CONFIRMED" | "REVERTED";
      };
      await setDrip(
        a.id,
        sent.txHash
          ? { status: sent.status ?? "SUBMITTED", txHash: sent.txHash }
          : { status: "BLOCKED", reason: result.decision.reasons.join("; ") },
      );
    } catch (e) {
      if (e instanceof DripAlreadyClaimedError) return;
      const reason = (e as Error).message;
      const l = await ledger();
      const attempts = l.logs.filter(
        (x) => x.intent === `ONBOARDING_GAS_DRIP:${a.id}`,
      );
      const last = attempts.at(-1);
      await setDrip(
        a.id,
        last?.txHash
          ? { status: "SUBMITTED", txHash: last.txHash, reason }
          : {
              status: attempts.some((x) => x.status === "BROADCASTING")
                ? "UNRESOLVED"
                : "SKIPPED",
              reason,
            },
      );
    }
  }, a.address);
}

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
