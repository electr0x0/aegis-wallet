// Operator setup for the on-chain AgentGuard (Base Sepolia only).
//
//   pnpm guard:deploy                 deploy, write GUARD_ADDRESS, move agent funds into the guard
//   pnpm guard:deploy --eth 0.005 --usdc 10
//   pnpm guard:deploy --fund-only     fund an already deployed guard
//   pnpm guard:deploy --renew         extend the session with an owner-signed setSession
//   pnpm guard:deploy --revoke        emergency stop: revoke the session key on-chain
//   pnpm guard:deploy --force         redeploy even if GUARD_ADDRESS is set
//
// This is a one-off operator step, not an agent action, so it signs directly with the agent key
// instead of going through executeAction. --revoke, and --renew after a revoke, may instead be
// sent by the owner key (see guard-session.ts). Every transaction is recorded in the ledger.
import { readFile, rename, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  createWalletClient,
  encodeFunctionData,
  formatEther,
  formatUnits,
  http,
  parseEther,
  parseUnits,
  zeroAddress,
  isAddress,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import artifact from "../src/lib/guard/AgentGuard.json";
import {
  EXPLORER,
  USDC,
  WETH,
  abi,
  account,
  guardAbi,
  guardAddress,
  publicClient,
  wallet,
} from "../src/lib/chain";
import { exclusive, ledger, log, saveLedger } from "../src/lib/store";
import { prepareSessionChange, type SessionOp } from "./guard-session";

const BASE_SEPOLIA_CHAIN_ID = 84532;
const ENV_FILE = ".env.local";
const RECEIPT_TIMEOUT_MS = 120_000;

const { values: flags } = parseArgs({
  options: {
    force: { type: "boolean", default: false },
    renew: { type: "boolean", default: false },
    revoke: { type: "boolean", default: false },
    "fund-only": { type: "boolean", default: false },
    eth: { type: "string", default: "0.002" },
    usdc: { type: "string" },
  },
});

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function sessionExpiry(): bigint {
  const hours = Number(process.env.SESSION_HOURS || 24);
  if (!(hours > 0)) throw new Error("SESSION_HOURS must be a positive number");
  return BigInt(nowSeconds() + Math.round(hours * 3600));
}

function ownerAccount() {
  const key = process.env.VAULT_PRIVATE_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error("VAULT_PRIVATE_KEY missing. Run pnpm setup-wallets first.");
  }
  return privateKeyToAccount(key as Hex);
}

function ownerAddress(): Hex {
  return ownerAccount().address;
}

// The owner sends its own transactions only for --revoke and --renew, when the relay can't be used.
function ownerWallet() {
  const url = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
  return createWalletClient({
    account: ownerAccount(),
    chain: baseSepolia,
    transport: http(url, { timeout: 15000, retryCount: 1 }),
  });
}

function vaultAddress(): Hex {
  const vault = process.env.VAULT_ADDRESS;
  if (!vault || !isAddress(vault)) {
    throw new Error("VAULT_ADDRESS missing or invalid");
  }
  return vault;
}

// Rewrites only the GUARD_ADDRESS line; other lines (secrets) are never printed.
async function upsertEnv(name: string, value: string) {
  let env = "";
  try {
    env = await readFile(ENV_FILE, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, "m");
  let next: string;
  if (pattern.test(env)) next = env.replace(pattern, line);
  else next = `${env}${env && !env.endsWith("\n") ? "\n" : ""}${line}\n`;
  // Temp file + rename: a crash mid-write must never truncate the secrets file.
  await writeFile(`${ENV_FILE}.tmp`, next, { mode: 0o600 });
  await rename(`${ENV_FILE}.tmp`, ENV_FILE);
  process.env[name] = value;
  console.log(`Wrote ${name}=${value} to ${ENV_FILE}`);
}

async function confirm(label: string, hash: Hex) {
  console.log(`${label}: ${EXPLORER}/tx/${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    timeout: RECEIPT_TIMEOUT_MS,
  });
  if (receipt.status !== "success") {
    throw new Error(`${label} reverted: ${EXPLORER}/tx/${hash}`);
  }
  return receipt;
}

async function record(intent: string, txHash: Hex, reasons: string[]) {
  await exclusive(async () => {
    const l = await ledger();
    log(l, {
      intent,
      tier: "SETUP",
      status: "CONFIRMED",
      simulation: "OPERATOR_SETUP",
      txHash,
      reasons,
      riskScore: 0,
      usd: 0,
      rationale:
        "Operator setup step for the on-chain AgentGuard. Not an agent decision.",
    });
    await saveLedger(l);
  });
}

async function deploy(): Promise<Hex> {
  const owner = ownerAddress();
  const vault = vaultAddress();
  const agent = account().address;
  const expiry = sessionExpiry();
  const args = [
    owner,
    agent,
    expiry,
    [WETH, USDC],
    [vault],
    [zeroAddress, WETH, USDC],
    [parseEther("0.01"), parseEther("0.01"), parseUnits("20", 6)],
    [parseEther("0.02"), parseEther("0.02"), parseUnits("50", 6)],
  ];

  const hash = await wallet().deployContract({
    abi: guardAbi,
    bytecode: artifact.bytecode as Hex,
    args,
  });
  const receipt = await confirm("AgentGuard deployment", hash);
  const guard = receipt.contractAddress;
  if (!guard) {
    throw new Error(`No contract address in receipt: ${EXPLORER}/tx/${hash}`);
  }

  console.log(`AgentGuard deployed at ${guard}`);
  await upsertEnv("GUARD_ADDRESS", guard);
  const until = new Date(Number(expiry) * 1000).toISOString();
  await record("SETUP_GUARD_DEPLOY", hash, [
    `Deployed AgentGuard at ${guard}`,
    `Owner ${owner}, session key ${agent} until ${until}`,
    "Limits: ETH 0.01/tx 0.02/day, WETH 0.01/tx 0.02/day, USDC 20/tx 50/day",
  ]);
  return guard;
}

async function fundEth(guard: Hex, amount: bigint) {
  if (amount === 0n) return;
  const hash = await wallet().sendTransaction({ to: guard, value: amount });
  await confirm("Fund guard with ETH", hash);
  await record("SETUP_GUARD_FUND_ETH", hash, [
    `Moved ${formatEther(amount)} ETH into the guard`,
  ]);
}

async function fundUsdc(guard: Hex, amount: bigint) {
  if (amount === 0n) {
    console.log("No USDC to move into the guard.");
    return;
  }
  const data = encodeFunctionData({
    abi,
    functionName: "transfer",
    args: [guard, amount],
  });
  const hash = await wallet().sendTransaction({ to: USDC, data });
  await confirm("Fund guard with USDC", hash);
  const moved = `Moved ${formatUnits(amount, 6)} USDC into the guard`;
  await record("SETUP_GUARD_FUND_USDC", hash, [moved]);
}

async function fund(guard: Hex) {
  const agent = account().address;
  const usdcBalance = await publicClient.readContract({
    address: USDC,
    abi,
    functionName: "balanceOf",
    args: [agent],
  });
  const usdc =
    flags.usdc === undefined ? usdcBalance : parseUnits(flags.usdc, 6);
  await fundEth(guard, parseEther(flags.eth));
  await fundUsdc(guard, usdc);
}

const SESSION_STEPS: Record<SessionOp, { label: string; intent: string }> = {
  revoke: { label: "Emergency stop", intent: "SETUP_GUARD_REVOKE" },
  renew: { label: "Session renewal", intent: "SETUP_GUARD_RENEW" },
};

// Normally the owner signs off-chain and the agent relays through executeApproved, paying gas.
// After a revoke the owner sends setSession itself. guard-session.ts picks the path and simulates.
async function changeSession(guard: Hex, op: SessionOp) {
  const { label, intent } = SESSION_STEPS[op];
  const change = await prepareSessionChange(op, {
    guard,
    owner: ownerAddress(),
    expiry: sessionExpiry(),
  });
  const sender = change.path === "owner" ? "Owner" : "Session key";
  console.log(
    `${label}: simulation passed. ${sender} ${change.payer} sends it.`,
  );

  const client = change.path === "owner" ? ownerWallet() : wallet();
  const hash = await client.sendTransaction(change.call);
  await confirm(label, hash);
  await record(intent, hash, change.reasons);
  for (const warning of change.warnings) console.warn(`WARNING: ${warning}`);
}

async function main() {
  const chainId = await publicClient.getChainId();
  if (chainId !== BASE_SEPOLIA_CHAIN_ID) {
    throw new Error(`RPC is on chain ${chainId}, not 84532`);
  }

  const existing = guardAddress();
  if (flags.revoke && (flags.renew || flags["fund-only"] || flags.force)) {
    throw new Error("--revoke runs on its own.");
  }
  if (flags.revoke || flags.renew || flags["fund-only"]) {
    if (!existing) throw new Error("GUARD_ADDRESS is not set. Deploy first.");
    if (flags.revoke) await changeSession(existing, "revoke");
    if (flags.renew) await changeSession(existing, "renew");
    if (flags["fund-only"]) await fund(existing);
    return;
  }
  if (existing && !flags.force) {
    console.log(
      `AgentGuard already deployed at ${EXPLORER}/address/${existing}`,
    );
    console.log(
      "Use --force to redeploy, --fund-only to fund it, --renew to extend the session, or --revoke for the emergency stop.",
    );
    return;
  }

  if (existing) {
    console.log(
      `Redeploying. Funds left in ${existing} need an owner-signed call to recover.`,
    );
  }
  const guard = await deploy();
  await fund(guard);
  console.log(`AgentGuard ready: ${EXPLORER}/address/${guard}`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
