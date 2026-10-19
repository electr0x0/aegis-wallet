import { readFile, rename, writeFile } from "node:fs/promises";
import { isAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const ENV_FILE = ".env.local";
const MIN_ETH = 0.0003;
const MIN_USDC = 0.5;
const UNFINISHED_STATUSES = [
  "CONFIRMED",
  "SUBMITTED",
  "BROADCASTING",
  "AWAITING_HITL_APPROVAL",
];

async function readEnvFile() {
  try {
    return await readFile(ENV_FILE, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw e;
  }
}

function loadIntoProcess(env: string) {
  for (const line of env.split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  }
}

function upsert(env: string, key: string, value: string) {
  const without = env.replace(new RegExp(`^${key}=.*\\r?\\n?`, "m"), "");
  return `${without.trimEnd()}\n${key}=${value}\n`;
}

// Creates missing keys without ever printing them. Existing configuration is preserved.
async function ensureKeys() {
  let env = await readEnvFile();
  loadIntoProcess(env);
  if (!process.env.AGENT_PRIVATE_KEY) {
    process.env.AGENT_PRIVATE_KEY = generatePrivateKey();
    env = upsert(env, "AGENT_PRIVATE_KEY", process.env.AGENT_PRIVATE_KEY);
  }
  // The vault key is the guard owner and is immutable on-chain: never replace one.
  const existingVaultKey = process.env.VAULT_PRIVATE_KEY as
    `0x${string}` | undefined;
  if (existingVaultKey) {
    const derived = privateKeyToAccount(existingVaultKey).address;
    const configured = process.env.VAULT_ADDRESS;
    if (configured && configured.toLowerCase() !== derived.toLowerCase()) {
      throw new Error("VAULT_ADDRESS does not match VAULT_PRIVATE_KEY");
    }
    if (!configured) {
      process.env.VAULT_ADDRESS = derived;
      env = upsert(env, "VAULT_ADDRESS", derived);
    }
  } else if (!process.env.VAULT_ADDRESS) {
    const vaultKey = generatePrivateKey();
    process.env.VAULT_PRIVATE_KEY = vaultKey;
    process.env.VAULT_ADDRESS = privateKeyToAccount(vaultKey).address;
    env = upsert(env, "VAULT_PRIVATE_KEY", vaultKey);
    env = upsert(env, "VAULT_ADDRESS", process.env.VAULT_ADDRESS);
  }
  const vault = process.env.VAULT_ADDRESS ?? "";
  if (!isAddress(vault)) throw new Error("VAULT_ADDRESS is invalid");
  // Temp file + rename: a crash mid-write must never truncate the secrets file.
  await writeFile(`${ENV_FILE}.tmp`, env, { mode: 0o600 });
  await rename(`${ENV_FILE}.tmp`, ENV_FILE);
  return vault;
}

async function main() {
  const vault = await ensureKeys();
  const { account, portfolio, WETH } = await import("../src/lib/chain");
  const { ledger, policy, saveJSON, exclusive } =
    await import("../src/lib/store");
  const { executeAction } = await import("../src/lib/agent/tools");

  console.log("Agent address:", account().address);
  console.log("Vault address:", vault);
  console.log(
    "Fund the agent with Base Sepolia ETH and USDC. The vault key stays private in .env.local.",
  );

  await exclusive(async () => {
    const p = await policy();
    const listed = p.whitelistedAddresses.some(
      (a) => a.toLowerCase() === vault.toLowerCase(),
    );
    if (!listed) {
      p.whitelistedAddresses.push(vault);
      await saveJSON("policy.json", p);
    }
  });

  let live;
  try {
    live = await portfolio();
  } catch (e) {
    console.log(
      "Wallet created. Live funding check unavailable:",
      (e as Error).message,
    );
    return;
  }
  if (
    Number(live.balances.ETH) < MIN_ETH ||
    Number(live.balances.USDC) < MIN_USDC
  ) {
    console.log(
      `Funding required at ${live.holder}: ${MIN_ETH} test ETH and ${MIN_USDC} test USDC. Rerun after funding.`,
    );
    return;
  }

  const steps = [
    {
      kind: "transfer_token",
      token: "USDC",
      amount: "0.50",
      recipient: vault,
      prompt: "SETUP_EVIDENCE_USDC",
    },
    {
      kind: "wrap_eth",
      token: "ETH",
      amount: "0.0002",
      recipient: WETH,
      prompt: "SETUP_EVIDENCE_WRAP",
    },
  ] as const;
  for (const step of steps) {
    const { logs } = await ledger();
    const attempted = logs.some(
      (x) => x.intent === step.prompt && UNFINISHED_STATUSES.includes(x.status),
    );
    if (attempted) {
      console.log(
        step.prompt,
        "already attempted; inspect evidence before retrying",
      );
      continue;
    }
    console.log(JSON.stringify(await executeAction({ ...step }), null, 2));
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
