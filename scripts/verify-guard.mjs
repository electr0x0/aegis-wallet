// Publishes the AgentGuard source so anyone can check the deployed bytecode against it.
//
//   pnpm guard:verify                    verify GUARD_ADDRESS (from .env.local or the shell)
//   pnpm guard:verify --address 0x...    verify a specific deployment
//
// Compiles locally, compares the result with eth_getCode, then submits the standard JSON input to
// Sourcify and, if Blockscout has not imported that result, to Blockscout. Neither needs an API key.
// Reads the chain only: no keys, no signing, no transactions.
import { parseArgs } from "node:util";
import solc from "solc";
import { createPublicClient, getAddress, http, isAddress } from "viem";
import { baseSepolia } from "viem/chains";
import { CONTRACT, SOURCE, standardJsonInput } from "./guard-source.mjs";

const CHAIN_ID = 84532;
const SOURCIFY = "https://sourcify.dev/server";
const BLOCKSCOUT = "https://base-sepolia.blockscout.com";
const POLL_MS = 5_000;
const POLL_ATTEMPTS = 36;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function targetAddress() {
  const { values } = parseArgs({ options: { address: { type: "string" } } });
  const value = values.address ?? process.env.GUARD_ADDRESS;
  if (!value || !isAddress(value)) {
    throw new Error("Pass --address 0x... or set GUARD_ADDRESS.");
  }
  return getAddress(value);
}

// "0.8.37+commit.f401782d.Emscripten.clang" -> "0.8.37+commit.f401782d"
function compilerVersion() {
  const match = solc.version().match(/^\d+\.\d+\.\d+\+commit\.[0-9a-f]{8}/);
  if (!match) throw new Error(`Unexpected solc version ${solc.version()}`);
  return match[0];
}

function compile() {
  const input = standardJsonInput([
    "abi",
    "evm.bytecode.object",
    "evm.deployedBytecode.object",
    "evm.deployedBytecode.immutableReferences",
    "metadata",
  ]);
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors ?? []).filter((d) => d.severity === "error");
  if (errors.length) throw new Error(errors[0].formattedMessage);
  const deployed = output.contracts[SOURCE][CONTRACT].evm.deployedBytecode;
  return {
    input,
    runtime: `0x${deployed.object}`,
    immutables: Object.values(deployed.immutableReferences ?? {}).flat(),
  };
}

// Immutables are written into the runtime code by the constructor, so they are compared as zeros.
function maskImmutables(code, references) {
  let masked = code;
  for (const { start, length } of references) {
    const from = 2 + start * 2;
    const to = from + length * 2;
    masked = masked.slice(0, from) + "00".repeat(length) + masked.slice(to);
  }
  return masked;
}

// The CBOR metadata (with the source hash) ends the runtime; its length is the last two bytes.
function withoutMetadata(code) {
  const length = parseInt(code.slice(-4), 16);
  return code.slice(0, code.length - (length + 2) * 2);
}

function immutableValues(code, references) {
  const words = references.map(({ start, length }) =>
    code.slice(2 + start * 2, 2 + (start + length) * 2),
  );
  return [...new Set(words)].map((word) => `0x${word.slice(24)}`);
}

async function compareWithChain(address, compiled) {
  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(
      process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
    ),
  });
  const chainId = await client.getChainId();
  if (chainId !== CHAIN_ID) {
    throw new Error(`RPC is on chain ${chainId}, expected ${CHAIN_ID}.`);
  }
  const onchain = (await client.getCode({ address }))?.toLowerCase();
  if (!onchain || onchain === "0x") {
    throw new Error(`No contract code at ${address} on Base Sepolia.`);
  }
  const local = maskImmutables(compiled.runtime, compiled.immutables);
  const deployed = maskImmutables(onchain, compiled.immutables);
  const references = compiled.immutables.length;
  const values = immutableValues(onchain, compiled.immutables).join(", ");
  console.log(
    `Masked ${references} immutable references (deployed value ${values})`,
  );
  if (local === deployed) {
    console.log("Runtime bytecode matches, metadata hash included.");
    return;
  }
  if (withoutMetadata(local) === withoutMetadata(deployed)) {
    console.log(
      "Runtime bytecode matches except the metadata hash: the source text or settings differ.",
    );
    return;
  }
  throw new Error(
    "Compiled runtime bytecode does not match the deployed code. Check git log for contracts/.",
  );
}

async function json(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 300) };
  }
}

async function sourcifyMatch(address) {
  const response = await fetch(
    `${SOURCIFY}/v2/contract/${CHAIN_ID}/${address}`,
  );
  if (!response.ok) return null;
  return (await json(response)).match ?? null;
}

async function verifyOnSourcify(address, input) {
  const existing = await sourcifyMatch(address);
  if (existing) return existing;
  const response = await fetch(`${SOURCIFY}/v2/verify/${CHAIN_ID}/${address}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      stdJsonInput: input,
      compilerVersion: compilerVersion(),
      contractIdentifier: `${SOURCE}:${CONTRACT}`,
    }),
  });
  const submitted = await json(response);
  if (!response.ok) {
    throw new Error(
      `Sourcify rejected the submission (${response.status}): ${submitted.message}`,
    );
  }
  console.log(`Sourcify job ${submitted.verificationId} accepted, polling...`);
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
    await sleep(POLL_MS);
    const job = await json(
      await fetch(`${SOURCIFY}/v2/verify/${submitted.verificationId}`),
    );
    if (!job.isJobCompleted) continue;
    if (job.error) {
      throw new Error(`Sourcify verification failed: ${job.error.message}`);
    }
    return job.contract.match;
  }
  throw new Error(
    "Sourcify job did not finish in time. Run the command again.",
  );
}

async function blockscoutStatus(address) {
  const response = await fetch(
    `${BLOCKSCOUT}/api/v2/smart-contracts/${address}`,
  );
  if (!response.ok) return null;
  const contract = await json(response);
  if (!contract.is_verified) return null;
  const match = contract.is_fully_verified ? "full match" : "partial match";
  // Blockscout often picks up a fresh Sourcify result through the Verifier Alliance database.
  if (contract.is_verified_via_sourcify)
    return `verified, ${match}, via Sourcify`;
  if (contract.is_verified_via_verifier_alliance) {
    return `verified, ${match}, via Verifier Alliance`;
  }
  return `verified, ${match}`;
}

async function verifyOnBlockscout(address, input) {
  const existing = await blockscoutStatus(address);
  if (existing) return existing;
  const form = new FormData();
  form.append("compiler_version", `v${compilerVersion()}`);
  form.append("contract_name", CONTRACT);
  form.append("license_type", "mit");
  form.append("autodetect_constructor_args", "true");
  const file = new Blob([JSON.stringify(input)], { type: "application/json" });
  form.append("files[0]", file, "AgentGuard.input.json");
  const response = await fetch(
    `${BLOCKSCOUT}/api/v2/smart-contracts/${address}/verification/via/standard-input`,
    { method: "POST", body: form },
  );
  const submitted = await json(response);
  if (!response.ok) {
    throw new Error(
      `Blockscout rejected the submission (${response.status}): ${submitted.message}`,
    );
  }
  console.log(`Blockscout: ${submitted.message}, polling...`);
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
    await sleep(POLL_MS);
    const status = await blockscoutStatus(address);
    if (status) return status;
  }
  throw new Error("Blockscout did not report the contract verified in time.");
}

async function main() {
  const address = targetAddress();
  console.log(`AgentGuard ${address} on Base Sepolia (${CHAIN_ID})`);
  const compiled = compile();
  console.log(`Compiled ${SOURCE}:${CONTRACT} with solc ${compilerVersion()}`);
  await compareWithChain(address, compiled);

  const sourcify = await verifyOnSourcify(address, compiled.input);
  console.log(`Sourcify: ${sourcify}`);
  console.log(`  https://repo.sourcify.dev/${CHAIN_ID}/${address}`);

  const blockscout = await verifyOnBlockscout(address, compiled.input);
  console.log(`Blockscout: ${blockscout}`);
  console.log(`  ${BLOCKSCOUT}/address/${address}?tab=contract`);

  // BaseScan needs an Etherscan API key, so it is left to the operator.
  console.log("BaseScan: skipped (needs an Etherscan API key).");
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
