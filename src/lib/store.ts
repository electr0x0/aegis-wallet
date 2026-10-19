import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { keccak256, recoverMessageAddress, toBytes, type Hex } from "viem";
import { ledgerSigner } from "./chain";
import { currentAccountId } from "./auth/context";
import type { Action, Decision, Policy } from "./security/policyEngine";

export type Entry = {
  accountId?: string;
  operationId?: string;
  id: string;
  timestamp: string;
  intent: string;
  tier: string;
  status: string;
  simulation: string;
  gasEstimate?: string;
  txHash?: string;
  reasons: string[];
  riskScore: number;
  usd: number;
  rationale?: string;
  policyHash?: Hex;
  // Seal: hash chain plus the agent key's EIP-191 signature over `hash`.
  prevHash?: Hex;
  hash?: Hex;
  signature?: Hex;
  signer?: Hex;
};

export type Proposal = {
  accountId?: string;
  id: string;
  action: Action;
  decision: Decision;
  gasEstimate: string;
  usd: number;
  status: string;
  rationale?: string;
};

export type Ledger = { logs: Entry[]; pending: Proposal[] };

export type LedgerVerification = {
  valid: boolean;
  entries: number;
  sealed: number;
  brokenAt?: string;
  reason?: string;
};

const root = path.join(process.cwd(), "data");
const GENESIS_HASH: Hex = `0x${"0".repeat(64)}`;

const DEFAULT_POLICY: Policy = {
  tier1SingleTxMaxUsd: 2,
  tier1DailyLimitUsd: 5,
  maxGasGwei: 25,
  whitelistedAddresses: [],
  blacklistedAddresses: ["0x000000000000000000000000000000000000dead"],
  requireApproval: false,
};

export async function readJSON<T>(name: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path.join(root, name), "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw e;
  }
}

// Write to a temp file, then rename: readers never see a half-written file.
export async function saveJSON(name: string, value: unknown) {
  await mkdir(path.dirname(path.join(root, name)), { recursive: true });
  const temp = path.join(root, `${name}.${randomUUID()}.tmp`);
  await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(temp, path.join(root, name));
}

export async function policy() {
  return readJSON<Policy>(policyFile(), DEFAULT_POLICY);
}

export function policyFile() {
  const id = currentAccountId();
  return id === "master" ? "policy.json" : `accounts/${id}/policy.json`;
}

export const ledger = () =>
  readJSON<Ledger>("audit_log.json", { logs: [], pending: [] });

// Process-wide mutex: every ledger and policy write runs inside it.
const state = globalThis as typeof globalThis & {
  aegisLock?: Promise<unknown>;
};
export function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const next = (state.aegisLock ?? Promise.resolve()).then(fn, fn);
  state.aegisLock = next.catch(() => {});
  return next;
}

export function log(l: Ledger, entry: Omit<Entry, "id" | "timestamp">): void {
  // Callers re-log a previous entry with a new status; its old seal must not carry over.
  // The deep copy keeps later caller mutations out of an already sealed entry.
  const { prevHash, hash, signature, signer, ...fields } = entry;
  l.logs.push({
    accountId: currentAccountId(),
    ...structuredClone(fields),
    id: randomUUID(),
    timestamp: new Date().toISOString(),
  });
}

// JSON with object keys sorted at every depth, so equal values hash equally.
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return v;
    const sorted = Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1));
    return Object.fromEntries(sorted);
  });
}

function hashOf(value: unknown): Hex {
  return keccak256(toBytes(canonicalJson(value)));
}

// The hashed body includes prevHash, which links each entry to the one before.
function entryHash(entry: Entry): Hex {
  const { hash, signature, signer, ...body } = entry;
  return hashOf(body);
}

export function policyHash(p: Policy): Hex {
  return hashOf(p);
}

async function seal(entry: Entry, prevHash: Hex): Promise<void> {
  entry.prevHash = prevHash;
  entry.hash = entryHash(entry);
  try {
    const agent = ledgerSigner();
    entry.signature = await agent.signMessage({ message: { raw: entry.hash } });
    entry.signer = agent.address;
  } catch {
    // No agent key configured: keep the hash chain, leave the entry unsigned.
  }
}

// Seals every unsealed entry in order, then persists. Call inside exclusive().
export async function saveLedger(l: Ledger): Promise<void> {
  let prevHash = GENESIS_HASH;
  for (const entry of l.logs) {
    if (!entry.hash) await seal(entry, prevHash);
    prevHash = entry.hash as Hex;
  }
  await saveJSON("audit_log.json", l);
}

function agentAddress(): Hex | null {
  try {
    return ledgerSigner().address;
  } catch {
    return null;
  }
}

async function recoverSigner(hash: Hex, signature: Hex): Promise<Hex | null> {
  try {
    return await recoverMessageAddress({ message: { raw: hash }, signature });
  } catch {
    return null;
  }
}

// Lowercase compare: a tampered, malformed address must fail the check, not throw.
function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

// Returns why the entry breaks the chain, or null when it holds.
async function checkEntry(
  entry: Entry,
  prevHash: Hex,
  agent: Hex | null,
  signedBefore: boolean,
): Promise<string | null> {
  if (!entry.hash) return "Entry is not sealed";
  if (entry.prevHash !== prevHash) {
    return "prevHash does not match the previous entry";
  }
  if (entryHash(entry) !== entry.hash) {
    return "Entry contents do not match its hash";
  }
  if (!entry.signature || !entry.signer) {
    // With an agent key configured, an unsigned entry is a stripped or forged one.
    if (agent) return "Entry is not signed by the agent key";
    return signedBefore ? "Signature missing after signed history" : null;
  }
  const recovered = await recoverSigner(entry.hash, entry.signature);
  if (!recovered || !sameAddress(recovered, entry.signer)) {
    return "Signature does not match the recorded signer";
  }
  // Anyone can sign with their own key; only the agent key counts.
  if (agent && !sameAddress(entry.signer, agent)) {
    return `Signed by ${entry.signer}, not the configured agent key`;
  }
  return null;
}

export async function verifyLedger(l: Ledger): Promise<LedgerVerification> {
  const agent = agentAddress();
  let prevHash = GENESIS_HASH;
  let sealed = 0;
  let signedBefore = false;
  for (const entry of l.logs) {
    const reason = await checkEntry(entry, prevHash, agent, signedBefore);
    if (reason) {
      return {
        valid: false,
        entries: l.logs.length,
        sealed,
        brokenAt: entry.id,
        reason,
      };
    }
    sealed++;
    signedBefore ||= Boolean(entry.signature);
    prevHash = entry.hash as Hex;
  }
  return { valid: true, entries: l.logs.length, sealed };
}
