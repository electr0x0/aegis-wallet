// Emergency stop (--revoke) and session renewal (--renew) for the on-chain AgentGuard. Used by
// scripts/deploy-guard.ts, which sends and records the call. Kept apart so the decision logic can be
// tested against a mocked chain.
//
// An owner call reaches the guard in one of two ways:
//   relay  the owner signs it off-chain and the session key submits it through executeApproved,
//          paying the gas. Only possible while the agent is the session key.
//   owner  the owner EOA (VAULT_PRIVATE_KEY) sends it itself and pays its own gas.
//
// revokeSession sets the session key to zero, so after a revoke nothing can be relayed and only the
// owner can renew. The stop prefers the owner path because it does not depend on the agent key it
// may be stopping. Renewal prefers the relay so the owner needs no gas in normal operation.
import {
  encodeFunctionData,
  formatEther,
  isAddressEqual,
  zeroAddress,
  type Hex,
} from "viem";
import {
  account,
  decodeGuardError,
  guardAbi,
  outerCall,
  publicClient,
  signOwnerApproval,
  type Call,
} from "../src/lib/chain";

// Upper bound for one admin call. Measured on Base Sepolia: owner revokeSession ~28k gas, owner
// setSession after a revoke ~46k. The headroom also covers the small L1 data fee.
const ADMIN_GAS_LIMIT = 150_000n;

export type SessionOp = "revoke" | "renew";
export type SessionPath = "relay" | "owner";

export type SessionState = {
  agent: Hex;
  owner: Hex;
  sessionKey: Hex;
  agentBalance: bigint;
  ownerBalance: bigint;
  /** Wei one admin call may cost at current fees. */
  gasBudget: bigint;
};

export type SessionPlan = { path: SessionPath; payer: Hex };

export type SessionChange = SessionPlan & {
  call: Call;
  reasons: string[];
  warnings: string[];
};

const FUNCTION_NAME: Record<SessionOp, string> = {
  revoke: "revokeSession",
  renew: "setSession",
};

function eth(wei: bigint): string {
  return `${formatEther(wei)} ETH`;
}

export function isRevoked(sessionKey: Hex): boolean {
  return isAddressEqual(sessionKey, zeroAddress);
}

function cannotPay(op: SessionOp, state: SessionState, canRelay: boolean) {
  const functionName = FUNCTION_NAME[op];
  const need = eth(state.gasBudget);
  const owner = `owner ${state.owner} (has ${eth(state.ownerBalance)})`;
  if (!canRelay) {
    const why = isRevoked(state.sessionKey)
      ? "The session is revoked"
      : `The session key is ${state.sessionKey}, not the agent`;
    return `${why}, so the agent cannot relay ${functionName}. The owner must send it and pay its own gas: fund ${owner} with at least ${need}.`;
  }
  const agent = `agent ${state.agent} (has ${eth(state.agentBalance)})`;
  return `No key can pay for ${functionName}. Fund ${owner} or ${agent} with at least ${need}.`;
}

/** Picks who sends the call. Throws, naming the address and amount to fund, when nobody can. */
export function chooseSessionPath(
  op: SessionOp,
  state: SessionState,
): SessionPlan {
  if (op === "revoke" && isRevoked(state.sessionKey)) {
    throw new Error(
      "The session is already revoked, so there is nothing to stop. Use --renew to restore it.",
    );
  }
  const canRelay = isAddressEqual(state.sessionKey, state.agent);
  const ownerCanPay = state.ownerBalance >= state.gasBudget;
  const agentCanPay = canRelay && state.agentBalance >= state.gasBudget;
  const preferred: SessionPath[] =
    op === "revoke" ? ["owner", "relay"] : ["relay", "owner"];
  for (const path of preferred) {
    if (path === "owner" && ownerCanPay) return { path, payer: state.owner };
    if (path === "relay" && agentCanPay) return { path, payer: state.agent };
  }
  throw new Error(cannotPay(op, state, canRelay));
}

function readGuard(guard: Hex, functionName: "owner" | "sessionKey") {
  return publicClient.readContract({
    address: guard,
    abi: guardAbi,
    functionName,
  }) as Promise<Hex>;
}

async function readState(guard: Hex, owner: Hex): Promise<SessionState> {
  const agent = account().address;
  const [onChainOwner, sessionKey, agentBalance, ownerBalance, fees] =
    await Promise.all([
      readGuard(guard, "owner"),
      readGuard(guard, "sessionKey"),
      publicClient.getBalance({ address: agent }),
      publicClient.getBalance({ address: owner }),
      publicClient.estimateFeesPerGas(),
    ]);
  if (!isAddressEqual(onChainOwner, owner)) {
    throw new Error("VAULT_PRIVATE_KEY is not the owner of GUARD_ADDRESS");
  }
  const gasBudget = ADMIN_GAS_LIMIT * fees.maxFeePerGas;
  return { agent, owner, sessionKey, agentBalance, ownerBalance, gasBudget };
}

function innerCall(op: SessionOp, guard: Hex, agent: Hex, expiry: bigint) {
  const data =
    op === "revoke"
      ? encodeFunctionData({ abi: guardAbi, functionName: "revokeSession" })
      : encodeFunctionData({
          abi: guardAbi,
          functionName: "setSession",
          args: [agent, expiry],
        });
  return { to: guard, value: 0n, data };
}

function describeChange(
  op: SessionOp,
  state: SessionState,
  plan: SessionPlan,
  expiry: bigint,
): string[] {
  const how =
    plan.path === "relay"
      ? `Owner-signed, relayed by session key ${state.agent} through executeApproved`
      : `Sent directly by owner ${state.owner}`;
  if (op === "revoke") {
    const cleared = `Emergency stop: revokeSession cleared session key ${state.sessionKey}`;
    return [cleared, how];
  }
  const until = new Date(Number(expiry) * 1000).toISOString();
  return [`setSession: ${state.agent} until ${until}`, how];
}

// After a revoke only the owner can renew, so say so while the operator is still at the console.
function recoveryWarnings(
  op: SessionOp,
  state: SessionState,
  plan: SessionPlan,
): string[] {
  if (op !== "revoke") return [];
  const spent = plan.path === "owner" ? state.gasBudget : 0n;
  if (state.ownerBalance - spent >= state.gasBudget) return [];
  return [
    `Only the owner can renew after this revoke. Fund owner ${state.owner} with at least ${eth(state.gasBudget)} (it has ${eth(state.ownerBalance)}) before running --renew.`,
  ];
}

/**
 * Reads the guard, picks the path, builds the call and simulates it from the payer. Throws, and
 * nothing is sent, when nobody can pay or the simulation fails.
 */
export async function prepareSessionChange(
  op: SessionOp,
  { guard, owner, expiry }: { guard: Hex; owner: Hex; expiry: bigint },
): Promise<SessionChange> {
  const state = await readState(guard, owner);
  const plan = chooseSessionPath(op, state);
  const inner = innerCall(op, guard, state.agent, expiry);
  const call =
    plan.path === "relay"
      ? outerCall(inner, await signOwnerApproval(inner))
      : inner;

  try {
    await publicClient.estimateGas({ ...call, account: plan.payer });
  } catch (e) {
    const reason = decodeGuardError(e) ?? (e as Error).message;
    throw new Error(
      `${FUNCTION_NAME[op]} failed in simulation, so nothing was sent: ${reason}`,
    );
  }

  return {
    ...plan,
    call,
    reasons: describeChange(op, state, plan, expiry),
    warnings: recoveryWarnings(op, state, plan),
  };
}
