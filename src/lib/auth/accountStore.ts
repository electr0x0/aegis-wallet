import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import {
  exclusive,
  ledger,
  log,
  policy,
  readJSON,
  saveJSON,
  saveLedger,
} from "../store";
import { currentAccountId, withAccount, type AccountContext } from "./context";

export const DEMO_PIN = "884210";
export type RiskProfile = "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE";
export type AccountRole = "INSTITUTIONAL_ADMIN" | "OPERATOR";
export type Drip = {
  status:
    | "PENDING"
    | "ATTEMPTED"
    | "SKIPPED"
    | "BLOCKED"
    | "AWAITING_HITL_APPROVAL"
    | "BROADCASTING"
    | "SUBMITTED"
    | "CONFIRMED"
    | "REVERTED"
    | "UNRESOLVED";
  reason?: string;
  txHash?: string;
};
type StoredAccount = {
  id: string;
  name: string;
  role: AccountRole;
  address: Hex;
  keyStatus: "HSM_ENV_ISOLATED" | "PIN_AES_256_GCM";
  profile: RiskProfile;
  salt: string;
  verifier: string;
  createdAt: string;
  encryptedKey?: { iv: string; tag: string; ciphertext: string };
  failedAttempts: number;
  lockedUntil: number;
  drip: Drip;
};
type AccountFile = { accounts: StoredAccount[] };
export type PublicAccount = Pick<
  StoredAccount,
  | "id"
  | "name"
  | "role"
  | "address"
  | "keyStatus"
  | "profile"
  | "createdAt"
  | "drip"
>;
const state = globalThis as typeof globalThis & {
  aegisSessions?: Map<string, { context: AccountContext; expires: number }>;
};
const sessions = (state.aegisSessions ??= new Map());
const SESSION_MS = 30 * 60_000;

function masterKey(): Hex {
  const key = process.env.AGENT_PRIVATE_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key))
    throw new Error("Run pnpm setup-wallets to configure the master account.");
  return key as Hex;
}
const masterContext = (): AccountContext => ({
  id: "master",
  key: masterKey(),
  guard: true,
});
const publicAccount = ({
  id,
  name,
  role,
  address,
  keyStatus,
  profile,
  createdAt,
  drip,
}: StoredAccount): PublicAccount => ({
  id,
  name,
  role,
  address,
  keyStatus,
  profile,
  createdAt,
  drip,
});

async function serverSalt() {
  const saved = await readJSON<{ salt: string } | null>("auth_salt.json", null);
  if (saved) return saved.salt;
  const salt = randomBytes(32).toString("hex");
  await saveJSON("auth_salt.json", { salt });
  return salt;
}
function derive(pin: string, salt: string, secret: string) {
  return scryptSync(pin, `${secret}:${salt}`, 32);
}
function verifier(key: Buffer) {
  return createHmac("sha256", key)
    .update("aegis-operator-pin-v1")
    .digest("hex");
}
const aad = (a: Pick<StoredAccount, "id" | "address" | "role">) =>
  Buffer.from(`${a.id}:${a.address}:${a.role}`);

// Caller holds exclusive(). Salt and account initialization cannot race.
async function accountsInLock(): Promise<AccountFile> {
  const file = await readJSON<AccountFile>("accounts.json", { accounts: [] });
  const address = privateKeyToAccount(masterKey()).address;
  const master = file.accounts.find((a) => a.id === "master");
  if (master && master.address !== address)
    throw new Error(
      "Master key changed: reconcile account metadata before continuing.",
    );
  if (!master) {
    const salt = randomBytes(16).toString("hex");
    const key = derive(DEMO_PIN, salt, await serverSalt());
    file.accounts.unshift({
      id: "master",
      name: "Master Demo Treasury (Pre-Funded)",
      role: "INSTITUTIONAL_ADMIN",
      address,
      keyStatus: "HSM_ENV_ISOLATED",
      profile: "BALANCED",
      salt,
      verifier: verifier(key),
      createdAt: new Date().toISOString(),
      failedAttempts: 0,
      lockedUntil: 0,
      drip: {
        status: "SKIPPED",
        reason:
          "Master funding is read from the chain; the preset name is not a balance claim.",
      },
    });
    key.fill(0);
    await saveJSON("accounts.json", file);
  }
  return file;
}
export async function listAccounts(): Promise<PublicAccount[]> {
  return exclusive(async () =>
    (await accountsInLock()).accounts.map(publicAccount),
  );
}

export function resolveSession(token?: string): AccountContext {
  if (!token) return masterContext();
  const session = sessions.get(token);
  if (!session || session.expires <= Date.now()) {
    sessions.delete(token);
    throw new Error("Session expired. Unlock an account to continue.");
  }
  return session.context;
}
function openSession(context: AccountContext) {
  for (const [token, session] of sessions)
    if (session.expires <= Date.now()) sessions.delete(token);
  const token = randomBytes(32).toString("hex");
  sessions.set(token, { context, expires: Date.now() + SESSION_MS });
  setTimeout(() => sessions.delete(token), SESSION_MS).unref();
  return token;
}
export function closeSession(token?: string) {
  if (token) sessions.delete(token);
}

async function auditAuth(id: string, success: boolean, purpose: string) {
  const l = await ledger();
  log(l, {
    accountId: id,
    intent: purpose,
    tier: "TIER_2_HITL",
    status: success ? "TIER_2_AUTH_SUCCESS" : "TIER_2_AUTH_FAILED",
    simulation: "NOT_APPLICABLE",
    reasons: [
      success
        ? "Operator PIN verified"
        : "Operator PIN rejected or temporarily locked",
    ],
    riskScore: success ? 0 : 65,
    usd: 0,
  });
  await saveLedger(l);
}
// Run within exclusive(). A five-attempt lockout persists across server restarts.
async function authenticateInLock(
  id: string,
  pin: string | undefined,
  purpose: string,
): Promise<AccountContext> {
  const file = await accountsInLock();
  const a = file.accounts.find((a) => a.id === id);
  if (!a) throw new Error("Account not found");
  const key = derive(
    pin && /^\d{6}$/.test(pin) ? pin : "invalid",
    a.salt,
    await serverSalt(),
  );
  const valid =
    a.lockedUntil <= Date.now() &&
    timingSafeEqual(
      Buffer.from(a.verifier, "hex"),
      Buffer.from(verifier(key), "hex"),
    );
  if (!valid) {
    a.failedAttempts++;
    if (a.failedAttempts >= 5) {
      a.lockedUntil = Date.now() + 5 * 60_000;
      a.failedAttempts = 0;
    }
    await saveJSON("accounts.json", file);
    await auditAuth(id, false, purpose);
    key.fill(0);
    throw new Error(
      "Incorrect PIN or account temporarily locked. Try again after five minutes if locked.",
    );
  }
  let privateKey: Hex;
  try {
    if (a.id === "master") {
      privateKey = masterKey();
    } else {
      if (!a.encryptedKey) throw new Error("Encrypted account key missing");
      const cipher = createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(a.encryptedKey.iv, "hex"),
      );
      cipher.setAAD(aad(a));
      cipher.setAuthTag(Buffer.from(a.encryptedKey.tag, "hex"));
      privateKey = Buffer.concat([
        cipher.update(Buffer.from(a.encryptedKey.ciphertext, "hex")),
        cipher.final(),
      ]).toString() as Hex;
      if (privateKeyToAccount(privateKey).address !== a.address)
        throw new Error("Encrypted account address mismatch");
    }
  } catch {
    await auditAuth(id, false, purpose);
    throw new Error(
      "Encrypted account could not be unlocked. Restore its private backup.",
    );
  } finally {
    key.fill(0);
  }
  a.failedAttempts = 0;
  a.lockedUntil = 0;
  await saveJSON("accounts.json", file);
  await auditAuth(id, true, purpose);
  return { id, key: privateKey, guard: id === "master" };
}
export async function requireStepUp(pin: string | undefined, purpose: string) {
  await authenticateInLock(currentAccountId(), pin, purpose);
}
export async function unlockAccount(id: string, pin: string) {
  return exclusive(async () => {
    const context = await authenticateInLock(id, pin, "ACCOUNT_UNLOCK");
    return {
      token: openSession(context),
      account: (await accountsInLock()).accounts
        .map(publicAccount)
        .find((a) => a.id === id)!,
    };
  });
}

export async function createAgentAccount(
  name: string,
  role: AccountRole,
  pin: string,
  profile: RiskProfile = "BALANCED",
) {
  if (
    !name.trim() ||
    name.trim().length > 80 ||
    !/^\d{6}$/.test(pin) ||
    !["OPERATOR", "INSTITUTIONAL_ADMIN"].includes(role) ||
    !["CONSERVATIVE", "BALANCED", "AGGRESSIVE"].includes(profile)
  )
    throw new Error("Enter a name, supported profile and six-digit PIN.");
  return exclusive(async () => {
    const file = await accountsInLock();
    if (file.accounts.length >= 50)
      throw new Error("Local demo account limit reached (50).");
    const privateKey = generatePrivateKey();
    const address = privateKeyToAccount(privateKey).address;
    const a: StoredAccount = {
      id: randomUUID(),
      name: name.trim(),
      role,
      address,
      keyStatus: "PIN_AES_256_GCM",
      profile,
      salt: randomBytes(16).toString("hex"),
      verifier: "",
      createdAt: new Date().toISOString(),
      failedAttempts: 0,
      lockedUntil: 0,
      drip: { status: "PENDING" },
    };
    const key = derive(pin, a.salt, await serverSalt());
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(aad(a));
    a.encryptedKey = {
      iv: iv.toString("hex"),
      ciphertext: Buffer.concat([
        cipher.update(privateKey, "utf8"),
        cipher.final(),
      ]).toString("hex"),
      tag: cipher.getAuthTag().toString("hex"),
    };
    a.verifier = verifier(key);
    key.fill(0);
    const base = await withAccount(masterContext(), () => policy());
    const cap = { CONSERVATIVE: 1, BALANCED: 2, AGGRESSIVE: 10 }[profile];
    await saveJSON(`accounts/${a.id}/policy.json`, {
      ...base,
      tier1SingleTxMaxUsd: cap,
      tier1DailyLimitUsd: cap * 5,
    });
    file.accounts.push(a);
    await saveJSON("accounts.json", file);
    const l = await ledger();
    log(l, {
      accountId: a.id,
      intent: "ACCOUNT_PROVISIONED",
      tier: "TIER_0",
      status: "COMPLETED",
      simulation: "NOT_APPLICABLE",
      reasons: [`${profile} profile; fresh encrypted EOA ${address}`],
      riskScore: 0,
      usd: 0,
    });
    await saveLedger(l);
    return {
      account: publicAccount(a),
      token: openSession({ id: a.id, key: privateKey, guard: false }),
    };
  });
}

// The caller holds exclusive(); consumed before any RPC or broadcast. Never retried.
export class DripAlreadyClaimedError extends Error {}

export async function claimDrip(address: string) {
  if (currentAccountId() !== "master")
    throw new Error("Only the master treasury can fund onboarding.");
  const file = await accountsInLock();
  const a = file.accounts.find(
    (a) =>
      a.id !== "master" && a.address.toLowerCase() === address.toLowerCase(),
  );
  if (!a || a.drip.status !== "PENDING")
    throw new DripAlreadyClaimedError(
      "Onboarding drip already attempted or recipient not provisioned.",
    );
  a.drip = {
    status: "ATTEMPTED",
    reason: "One-time funding attempt reserved; do not retry automatically.",
  };
  await saveJSON("accounts.json", file);
  return a.id;
}
export async function setDrip(id: string, drip: Drip) {
  return exclusive(async () => {
    const file = await accountsInLock();
    const a = file.accounts.find((a) => a.id === id);
    if (a) {
      a.drip = drip;
      await saveJSON("accounts.json", file);
    }
  });
}
export const withMasterFunding = <T>(fn: () => T, onboardingRecipient?: Hex) =>
  withAccount({ ...masterContext(), guard: false, onboardingRecipient }, fn);
