// Independent, read-only check of AegisWallet execution evidence.
//
//   pnpm verify:evidence                              data/audit_log.json
//   pnpm verify:evidence path/to/aegis-evidence.json  the dashboard export
//   pnpm verify:evidence <path> --signer 0x...        expected ledger signer (agent address)
//   pnpm verify:evidence <path> --offline             skip the on-chain receipt checks
//
// It reimplements the ledger seal with viem alone and does not import src/lib/store.ts, so a bug
// in the code that writes the ledger cannot also hide itself here. It never signs, never writes a
// file and never loads keys.

import {
  concat,
  decodeFunctionData,
  erc20Abi,
  keccak256,
  parseAbi,
  recoverAddress,
  stringToBytes,
  stringToHex,
  type Hex,
} from "viem";

export type EvidenceEntry = {
  id: string;
  accountId?: string;
  intent: string;
  status: string;
  simulation?: string;
  rationale?: string;
  reasons?: string[];
  txHash?: Hex;
  prevHash?: Hex;
  hash?: Hex;
  signature?: Hex;
  signer?: Hex;
  [field: string]: unknown;
};

// A full ledger links back to genesis. The dashboard export holds one account's entries only, so
// links to other accounts' entries show up as gaps there.
export type Evidence = { entries: EvidenceEntry[]; complete: boolean };

export type Row = {
  entry: EvidenceEntry;
  link: "ok" | "gap" | "BROKEN";
  hash: "ok" | "BAD";
  signature: "ok" | "BAD" | "MISSING";
  onchain: string;
  problems: string[];
};

export type Report = {
  rows: Row[];
  signer: Hex | null;
  gaps: number;
  brokenLinks: number;
  badHashes: number;
  validSignatures: number;
  receipts: { checked: number; matched: number } | null;
  ok: boolean;
};

// The three reads the receipt checks need. A viem public client satisfies it.
export type ChainReader = {
  getChainId(): Promise<number>;
  getTransaction(args: { hash: Hex }): Promise<EvidenceTransaction>;
  getTransactionReceipt(args: {
    hash: Hex;
  }): Promise<{ status: "success" | "reverted"; contractAddress?: Hex | null }>;
};
type EvidenceTransaction = {
  to: Hex | null;
  from: Hex;
  input: Hex;
  value: bigint;
  chainId?: number;
};

const CHAIN_ID = 84532;
const GENESIS_HASH: Hex = `0x${"0".repeat(64)}`;
const SUCCESS_STATUSES = ["CONFIRMED"];
const REVERTED_STATUSES = ["REVERTED", "REVERTED_BY_GUARD"];
const guardAbi = parseAbi([
  "function execute(address target, uint256 value, bytes data)",
  "function executeApproved(address target, uint256 value, bytes data, uint256 nonce, uint256 deadline, bytes signature)",
]);
export const ownerAbi = parseAbi(["function owner() view returns (address)"]);

export function parseEvidence(raw: unknown): Evidence {
  if (Array.isArray(raw)) return { entries: raw, complete: false };
  const logs = (raw as { logs?: unknown })?.logs;
  if (Array.isArray(logs)) return { entries: logs, complete: true };
  throw new Error(
    "Expected data/audit_log.json ({ logs: [...] }) or the aegis-evidence.json export ([...]).",
  );
}

// JSON with object keys sorted at every depth and undefined fields dropped, as the ledger hashes it.
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    const items = value.map((item) =>
      item === undefined ? "null" : canonicalJson(item),
    );
    return `[${items.join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    const fields = keys.map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`,
    );
    return `{${fields.join(",")}}`;
  }
  return JSON.stringify(value);
}

// The sealed body is every field except the seal itself; it includes prevHash.
export function entryHash(entry: EvidenceEntry): Hex {
  const { hash, signature, signer, ...body } = entry;
  return keccak256(stringToBytes(canonicalJson(body)));
}

// EIP-191 personal_sign over the 32 raw hash bytes.
async function recoverSealer(hash: Hex, signature: Hex): Promise<Hex | null> {
  const prefix = stringToHex("\x19Ethereum Signed Message:\n32");
  try {
    const digest = keccak256(concat([prefix, hash]));
    return await recoverAddress({ hash: digest, signature });
  } catch {
    return null;
  }
}

function sameAddress(a: unknown, b: unknown): boolean {
  return (
    typeof a === "string" &&
    typeof b === "string" &&
    a.toLowerCase() === b.toLowerCase()
  );
}

function short(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function expectedSigner(entries: EvidenceEntry[], flag?: Hex): Hex | null {
  if (flag) return flag;
  const recorded = new Set(
    entries.map((entry) => entry.signer?.toLowerCase()).filter(Boolean),
  );
  if (recorded.size !== 1) return null;
  return entries.find((entry) => entry.signer)!.signer as Hex;
}

export function recordedGuard(entries: EvidenceEntry[]): Hex | null {
  for (const entry of entries) {
    for (const reason of entry.reasons ?? []) {
      const match = reason.match(/^Deployed AgentGuard at (0x[0-9a-fA-F]{40})/);
      if (match) return match[1] as Hex;
    }
  }
  return null;
}

function entryText(entry: EvidenceEntry): string {
  return [entry.intent, entry.simulation, ...(entry.reasons ?? [])].join("\n");
}

// The ledger names the guard as the call path for owner-approved, attack and funding entries.
function routedThroughGuard(entry: EvidenceEntry): boolean {
  return /AgentGuard\.execute|via AgentGuard|guard rejected|into the guard/.test(
    entryText(entry),
  );
}

// "transfer 2 USDC to 0x..." in the deterministic rationale, or the attack demo's intent.
function recordedRecipient(entry: EvidenceEntry): Hex | null {
  for (const text of [entry.rationale, entry.intent]) {
    const match = text?.match(/\btransfer\b[^\n]*? to (0x[0-9a-fA-F]{40})\b/);
    if (match) return match[1] as Hex;
  }
  return null;
}

type Call = { to: Hex | null; value: bigint; data: Hex };

function outerCall(tx: EvidenceTransaction): Call {
  return { to: tx.to ?? null, value: tx.value, data: tx.input };
}

// Unwraps AgentGuard.execute / executeApproved to the call the guard was asked to make.
function innerCall(tx: EvidenceTransaction, guard: Hex | null): Call {
  const outer = outerCall(tx);
  if (!guard || !sameAddress(tx.to, guard)) return outer;
  try {
    const { args } = decodeFunctionData({ abi: guardAbi, data: tx.input });
    return { to: args[0], value: args[1], data: args[2] };
  } catch {
    return outer;
  }
}

function tokenRecipient(call: Call): Hex | null {
  try {
    const { functionName, args } = decodeFunctionData({
      abi: erc20Abi,
      data: call.data,
    });
    return functionName === "transfer" ? args[0] : null;
  } catch {
    return null;
  }
}

function paidTo(call: Call): Hex | null {
  if (call.data === "0x" && call.value > 0n) return call.to;
  return tokenRecipient(call);
}

type OnChain = {
  tx: EvidenceTransaction;
  receipt: Awaited<ReturnType<ChainReader["getTransactionReceipt"]>>;
};
type Check = { problems: string[]; notes: string[] };

// CONFIRMED needs a successful receipt, REVERTED* a reverted one. Interim states need neither.
function expectedReceiptStatus(status: string): "success" | "reverted" | null {
  if (SUCCESS_STATUSES.includes(status)) return "success";
  if (REVERTED_STATUSES.includes(status)) return "reverted";
  return null;
}

function checkGuardPath(
  entry: EvidenceEntry,
  { tx, receipt }: OnChain,
  guard: Hex,
  check: Check,
) {
  const deploysGuard = entry.reasons?.some((reason) =>
    reason.startsWith("Deployed AgentGuard"),
  );
  if (deploysGuard) {
    if (tx.to || !sameAddress(receipt.contractAddress, guard)) {
      check.problems.push(`did not create the recorded guard ${guard}`);
    } else {
      check.notes.push(`created ${short(guard)}`);
    }
    return;
  }
  if (!routedThroughGuard(entry)) return;
  // A token deposit calls the token contract with transfer(guard, amount).
  const intoGuard =
    sameAddress(tx.to, guard) || sameAddress(paidTo(outerCall(tx)), guard);
  if (intoGuard) {
    check.notes.push(`guard ${short(guard)}`);
  } else {
    check.problems.push(`to ${tx.to}, not the recorded guard ${guard}`);
  }
}

// An emergency stop, and a renew after it, are sent by the guard's on-chain owner, not the agent key.
function sentByGuardOwner(
  entry: EvidenceEntry,
  tx: EvidenceTransaction,
  guard: Hex | null,
  guardOwner: Hex | undefined,
): boolean {
  if (entry.tier !== "SETUP" || !guard || !guardOwner) return false;
  return sameAddress(tx.from, guardOwner) && sameAddress(tx.to, guard);
}

function checkOnChain(
  entry: EvidenceEntry,
  found: OnChain,
  signer: Hex | null,
  guard: Hex | null,
  guardOwner?: Hex,
): Check {
  const { tx, receipt } = found;
  const check: Check = { problems: [], notes: [receipt.status] };
  if (tx.chainId !== undefined && tx.chainId !== CHAIN_ID) {
    check.problems.push(
      `transaction is on chain ${tx.chainId}, not ${CHAIN_ID}`,
    );
  }
  const expected = expectedReceiptStatus(entry.status);
  if (expected && receipt.status !== expected) {
    check.problems.push(
      `ledger says ${entry.status}, receipt says ${receipt.status}`,
    );
  }
  // The master account's transactions are sent by the same key that seals the ledger.
  const master = (entry.accountId ?? "master") === "master";
  if (master && signer && !sameAddress(tx.from, signer)) {
    if (sentByGuardOwner(entry, tx, guard, guardOwner)) {
      check.notes.push(`sent by guard owner ${short(guardOwner!)}`);
    } else {
      check.problems.push(
        `sent by ${tx.from}, not the ledger signer ${signer}`,
      );
    }
  }
  if (guard) checkGuardPath(entry, found, guard, check);
  const recipient = recordedRecipient(entry);
  if (recipient) {
    const paid = paidTo(innerCall(tx, guard));
    if (sameAddress(paid, recipient)) {
      check.notes.push(`pays ${short(recipient)}`);
    } else {
      check.problems.push(
        `pays ${paid ?? "nobody"}, ledger records ${recipient}`,
      );
    }
  }
  return check;
}

async function fetchOnChain(
  client: ChainReader,
  hash: Hex,
): Promise<OnChain | Error> {
  try {
    const tx = await client.getTransaction({ hash });
    const receipt = await client.getTransactionReceipt({ hash });
    return { tx, receipt };
  } catch (e) {
    return e as Error;
  }
}

type Seal = Pick<Row, "link" | "hash" | "signature"> & { problems: string[] };

async function checkSeal(
  entry: EvidenceEntry,
  previous: Hex,
  complete: boolean,
  signer: Hex | null,
): Promise<Seal> {
  const seal: Seal = { link: "ok", hash: "ok", signature: "ok", problems: [] };
  if (entry.prevHash !== previous) {
    seal.link = complete ? "BROKEN" : "gap";
    if (complete) {
      seal.problems.push("prevHash does not match the previous entry");
    }
  }
  if (entry.hash !== entryHash(entry)) {
    seal.hash = "BAD";
    seal.problems.push("contents do not match the recorded hash");
  }
  if (!entry.hash || !entry.signature) {
    seal.signature = "MISSING";
    seal.problems.push("entry is not signed");
    return seal;
  }
  const sealer = await recoverSealer(entry.hash, entry.signature);
  if (!sameAddress(sealer, entry.signer) || !sameAddress(sealer, signer)) {
    seal.signature = "BAD";
    seal.problems.push(`signed by ${sealer ?? "nobody"}, expected ${signer}`);
  }
  return seal;
}

export async function verifyEvidence(
  evidence: Evidence,
  options: {
    signer?: Hex;
    client?: ChainReader | null;
    guardOwner?: Hex;
    guard?: Hex;
  } = {},
): Promise<Report> {
  const { entries, complete } = evidence;
  const signer = expectedSigner(entries, options.signer);
  const guard = options.guard ?? recordedGuard(entries);
  const client = options.client ?? null;
  if (client) {
    const chainId = await client.getChainId();
    if (chainId !== CHAIN_ID) {
      throw new Error(`RPC is on chain ${chainId}, expected ${CHAIN_ID}.`);
    }
  }

  // Entries that share a transaction (SUBMITTED, then CONFIRMED) fetch it once.
  const fetched = new Map<Hex, OnChain | Error>();
  const receiptOk = new Map<Hex, boolean>();
  const rows: Row[] = [];
  let previous = GENESIS_HASH;
  for (const entry of entries) {
    const seal = await checkSeal(entry, previous, complete, signer);
    const problems = [...seal.problems];
    if (expectedReceiptStatus(entry.status) && !entry.txHash) {
      problems.push(`status ${entry.status} but no transaction hash`);
    }

    let onchain = entry.txHash ? "not checked" : "-";
    if (entry.txHash && client) {
      if (!fetched.has(entry.txHash)) {
        fetched.set(entry.txHash, await fetchOnChain(client, entry.txHash));
      }
      const found = fetched.get(entry.txHash)!;
      const check =
        found instanceof Error
          ? {
              problems: [`no receipt: ${found.message.split("\n")[0]}`],
              notes: ["missing"],
            }
          : checkOnChain(entry, found, signer, guard, options.guardOwner);
      problems.push(...check.problems);
      onchain = check.notes.join(", ");
      const okSoFar = receiptOk.get(entry.txHash) ?? true;
      receiptOk.set(entry.txHash, okSoFar && check.problems.length === 0);
    }

    rows.push({ entry, ...seal, onchain, problems });
    previous = entry.hash ?? GENESIS_HASH;
  }

  const matched = [...receiptOk.values()].filter(Boolean).length;
  return {
    rows,
    signer,
    gaps: rows.filter((row) => row.link === "gap").length,
    brokenLinks: rows.filter((row) => row.link === "BROKEN").length,
    badHashes: rows.filter((row) => row.hash === "BAD").length,
    validSignatures: rows.filter((row) => row.signature === "ok").length,
    receipts: client ? { checked: receiptOk.size, matched } : null,
    ok:
      entries.length > 0 &&
      signer !== null &&
      rows.every((row) => row.problems.length === 0),
  };
}

export function summaryLine(report: Report): string {
  const parts = [`${report.rows.length} entries`];
  if (report.brokenLinks || report.badHashes) {
    parts.push(
      `chain BROKEN (${report.brokenLinks} bad links, ${report.badHashes} bad hashes)`,
    );
  } else if (report.gaps) {
    const plural = report.gaps === 1 ? "" : "s";
    parts.push(`chain intact within the export, ${report.gaps} gap${plural}`);
  } else {
    parts.push("chain intact");
  }
  parts.push(`${report.validSignatures} signatures valid`);
  parts.push(
    report.receipts
      ? `${report.receipts.matched}/${report.receipts.checked} receipts match`
      : "receipts not checked",
  );
  return parts.join(", ");
}
