// Plays a fully compromised agent. It holds the real session key and skips every off-chain defence
// (policy engine, prompt-injection filter, human approval) by calling AgentGuard directly. Only the
// contract stands between it and the funds.
//
//   pnpm guard:attack              simulate three attacks; nothing is sent
//   pnpm guard:attack --broadcast  also send attack (a) so the on-chain revert is BaseScan evidence
import { parseArgs } from "node:util";
import {
  encodeFunctionData,
  formatUnits,
  isAddress,
  maxUint256,
  parseAbi,
  parseEther,
  type Hex,
} from "viem";
import {
  EXPLORER,
  USDC,
  abi,
  account,
  decodeGuardError,
  guardAbi,
  guardAddress,
  publicClient,
  wallet,
} from "../src/lib/chain";
import { exclusive, ledger, log, saveLedger } from "../src/lib/store";

const ATTACKER = "0x1337000000000000000000000000000000001337";
// Explicit gas skips estimateGas, which would refuse to send a call it knows reverts.
const BROADCAST_GAS = 120_000n;
const approveAbi = parseAbi([
  "function approve(address,uint256) returns (bool)",
]);

const { values: flags } = parseArgs({
  options: { broadcast: { type: "boolean", default: false } },
});

type Attack = { label: string; target: Hex; value: bigint; data: Hex };

function vaultAddress(): Hex {
  const vault = process.env.VAULT_ADDRESS;
  if (!vault || !isAddress(vault)) {
    throw new Error("VAULT_ADDRESS missing or invalid");
  }
  return vault;
}

function buildAttacks(usdcBalance: bigint): Attack[] {
  const drain = encodeFunctionData({
    abi,
    functionName: "transfer",
    args: [ATTACKER, usdcBalance],
  });
  const approve = encodeFunctionData({
    abi: approveAbi,
    functionName: "approve",
    args: [ATTACKER, maxUint256],
  });
  return [
    {
      label: `(a) transfer all ${formatUnits(usdcBalance, 6)} USDC to ${ATTACKER}`,
      target: USDC,
      value: 0n,
      data: drain,
    },
    {
      label: "(b) send 0.05 ETH to the vault, over the 0.01 ETH per-tx cap",
      target: vaultAddress(),
      value: parseEther("0.05"),
      data: "0x",
    },
    {
      label: `(c) USDC approve(${ATTACKER}, max)`,
      target: USDC,
      value: 0n,
      data: approve,
    },
  ];
}

async function simulate(guard: Hex, attack: Attack): Promise<string | null> {
  try {
    await publicClient.simulateContract({
      address: guard,
      abi: guardAbi,
      functionName: "execute",
      args: [attack.target, attack.value, attack.data],
      account: account(),
    });
    return null;
  } catch (e) {
    return (
      decodeGuardError(e) ??
      `Reverted, reason not decoded: ${(e as Error).message}`
    );
  }
}

async function broadcast(
  guard: Hex,
  attack: Attack,
  reason: string,
  usd: number,
) {
  const data = encodeFunctionData({
    abi: guardAbi,
    functionName: "execute",
    args: [attack.target, attack.value, attack.data],
  });
  const hash = await wallet().sendTransaction({
    to: guard,
    data,
    gas: BROADCAST_GAS,
  });
  console.log(`Broadcast attack (a): ${EXPLORER}/tx/${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    timeout: 120_000,
  });
  const reverted = receipt.status === "reverted";
  console.log(
    reverted
      ? "Reverted on-chain by AgentGuard."
      : "UNEXPECTED: transaction succeeded.",
  );
  if (!reverted) process.exitCode = 1;

  await exclusive(async () => {
    const l = await ledger();
    log(l, {
      intent: `ATTACK_DEMO: compromised agent key tries to ${attack.label}`,
      tier: reverted ? "BLOCKED" : "UNEXPECTED",
      status: reverted ? "REVERTED_BY_GUARD" : receipt.status.toUpperCase(),
      simulation: reason,
      txHash: hash,
      reasons: [
        "Off-chain policy bypassed on purpose: the call went straight to AgentGuard.execute",
        reason,
      ],
      riskScore: 100,
      usd,
      rationale:
        "Attack demo: the session-key limits are enforced by the contract itself.",
    });
    await saveLedger(l);
  });
}

async function main() {
  const guard = guardAddress();
  if (!guard) {
    console.log("GUARD_ADDRESS is not set. Run pnpm guard:deploy first.");
    return;
  }
  const usdcBalance = await publicClient.readContract({
    address: USDC,
    abi,
    functionName: "balanceOf",
    args: [guard],
  });
  const attacks = buildAttacks(usdcBalance);
  console.log(
    `Compromised session key ${account().address} vs AgentGuard ${guard}\n`,
  );

  const reasons: (string | null)[] = [];
  for (const attack of attacks) {
    const reason = await simulate(guard, attack);
    reasons.push(reason);
    console.log(attack.label);
    console.log(`  -> ${reason ?? "NOT BLOCKED: simulation succeeded"}\n`);
    if (!reason) process.exitCode = 1;
  }

  if (!flags.broadcast) return;
  const reason = reasons[0];
  if (!reason) {
    throw new Error(
      "Attack (a) was not blocked in simulation. Refusing to broadcast.",
    );
  }
  await broadcast(
    guard,
    attacks[0],
    reason,
    Number(formatUnits(usdcBalance, 6)),
  );
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
