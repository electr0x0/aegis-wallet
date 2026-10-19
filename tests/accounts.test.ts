import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { parseEther, parseUnits } from "viem";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  files: new Map<string, string>(),
  send: vi.fn(),
  balance: vi.fn(),
  chainId: vi.fn(),
  simulate: vi.fn(),
}));
// Fully isolated in-memory disk: these tests never touch the operator's keys or ledger.
vi.mock("node:fs/promises", () => ({
  mkdir: async () => {},
  readFile: async (path: string) => {
    const s = mocks.files.get(String(path));
    if (s === undefined)
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    return s;
  },
  writeFile: async (path: string, value: string) => {
    mocks.files.set(String(path), value);
  },
  rename: async (from: string, to: string) => {
    mocks.files.set(String(to), mocks.files.get(String(from))!);
    mocks.files.delete(String(from));
  },
}));
vi.mock("../src/lib/chain", async () => {
  const { currentAccount } = await import("../src/lib/auth/context");
  const { privateKeyToAccount } = await import("viem/accounts");
  const { parseUnits } = await import("viem");
  const master = () =>
    privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as `0x${string}`);
  const account = () =>
    currentAccount() ? privateKeyToAccount(currentAccount()!.key) : master();
  return {
    WETH: "0x4200000000000000000000000000000000000006",
    USDC: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    account,
    ledgerSigner: master,
    holderAddress: () => account().address,
    wallet: () => ({ sendTransaction: mocks.send }),
    transaction: (a: { recipient: string; amount: string; token: string }) => ({
      to: a.recipient,
      value: parseUnits(a.amount, a.token === "USDC" ? 6 : 18),
    }),
    holderBalance: async () => parseUnits("100", 18),
    tokenDecimals: (token: string) => (token === "USDC" ? 6 : 18),
    guardAddress: () => null,
    guardStatus: async () => null,
    outerCall: (c: unknown) => c,
    decodeGuardError: () => null,
    signOwnerApproval: vi.fn(),
    portfolio: async () => ({
      agent: account().address,
      address: account().address,
      holder: account().address,
      mode: "eoa",
      balances: { ETH: "0.01", USDC: "10", WETH: "0" },
      totalUsd: 35,
      gasGwei: 1,
    }),
    publicClient: {
      getChainId: mocks.chainId,
      getBalance: mocks.balance,
      estimateGas: mocks.simulate,
      getGasPrice: async () => 1_000_000_000n,
      call: async () => ({ data: "0x01" }),
      waitForTransactionReceipt: async () => ({ status: "success" }),
    },
  };
});

import {
  createAgentAccount,
  listAccounts,
  resolveSession,
  unlockAccount,
  requireStepUp,
  withMasterFunding,
} from "../src/lib/auth/accountStore";
import { currentAccountId, withAccount } from "../src/lib/auth/context";
import {
  exclusive,
  ledger,
  policy,
  saveJSON,
  verifyLedger,
} from "../src/lib/store";
import { autoDrip, decide, executeAction } from "../src/lib/agent/tools";
import { GET, POST } from "../src/app/api/agent/route";

const destination = "0x1111111111111111111111111111111111111111";
const action = {
  kind: "transfer_token" as const,
  token: "USDC" as const,
  amount: "3",
  recipient: destination,
  prompt: "Transfer 3 USDC",
};
beforeEach(() => {
  vi.stubEnv("AGENT_PRIVATE_KEY", generatePrivateKey());
  mocks.files.clear();
  mocks.send.mockReset().mockResolvedValue(`0x${"a".repeat(64)}`);
  mocks.balance.mockReset().mockResolvedValue(parseEther("0.003"));
  mocks.chainId.mockReset().mockResolvedValue(84532);
  mocks.simulate.mockReset().mockResolvedValue(21000n);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

function post(body: object, token?: string) {
  return POST(
    new NextRequest("http://localhost:3000/api/agent", {
      method: "POST",
      headers: {
        host: "localhost:3000",
        origin: "http://localhost:3000",
        "Content-Type": "application/json",
        ...(token ? { cookie: `aegis_session=${token}` } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}
function get(token: string) {
  return GET(
    new NextRequest("http://localhost:3000/api/agent", {
      headers: { host: "localhost:3000", cookie: `aegis_session=${token}` },
    }),
  );
}

describe("Encrypted accounts and sessions", () => {
  it("rejects tampered GCM ciphertext and audits the failed unlock", async () => {
    const created = await createAgentAccount(
      "Encrypted wallet",
      "OPERATOR",
      "123456",
    );
    const file = [...mocks.files.keys()].find((x) =>
      x.endsWith("accounts.json"),
    )!;
    const saved = JSON.parse(mocks.files.get(file)!);
    const record = saved.accounts.find(
      (a: { id: string }) => a.id === created.account.id,
    );
    const tag = Buffer.from(record.encryptedKey.tag, "hex");
    tag[0] ^= 1;
    record.encryptedKey.tag = tag.toString("hex");
    mocks.files.set(file, JSON.stringify(saved));
    await expect(unlockAccount(created.account.id, "123456")).rejects.toThrow(
      "could not be unlocked",
    );
    delete record.encryptedKey;
    mocks.files.set(file, JSON.stringify(saved));
    await expect(unlockAccount(created.account.id, "123456")).rejects.toThrow(
      "could not be unlocked",
    );
    expect((await ledger()).logs.at(-1)?.status).toBe("TIER_2_AUTH_FAILED");
  });
  it("seeds only public master metadata, encrypts keys, and isolates preset policies", async () => {
    const [master] = await listAccounts();
    expect(master.id).toBe("master");
    expect(master.role).toBe("INSTITUTIONAL_ADMIN");
    const created = await createAgentAccount(
      "Organization",
      "OPERATOR",
      "123456",
      "AGGRESSIVE",
    );
    const context = resolveSession(created.token);
    const serialized = [...mocks.files.values()].join("\n");
    expect(serialized).not.toContain(context.key);
    expect(serialized).not.toContain('"123456"');
    expect(JSON.stringify(created.account)).not.toMatch(
      /verifier|ciphertext|salt|privateKey/,
    );
    expect(privateKeyToAccount(context.key).address).toBe(
      created.account.address,
    );
    expect(context.guard).toBe(false);
    expect(
      (await withAccount(context, () => policy())).tier1SingleTxMaxUsd,
    ).toBe(10);
    expect((await policy()).tier1SingleTxMaxUsd).toBe(2);
    const unlocked = await unlockAccount(created.account.id, "123456");
    expect(resolveSession(unlocked.token).key).toBe(context.key);
    await expect(unlockAccount(created.account.id, "884210")).rejects.toThrow(
      "Incorrect PIN",
    );
    expect((await verifyLedger(await ledger())).valid).toBe(true);
  });
  it("persists PIN lockout and expires sessions without falling back to master", async () => {
    const created = await createAgentAccount(
      "Locked org",
      "OPERATOR",
      "123456",
    );
    for (let i = 0; i < 5; i++)
      await expect(
        unlockAccount(created.account.id, "000000"),
      ).rejects.toThrow();
    await expect(unlockAccount(created.account.id, "123456")).rejects.toThrow();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 31 * 60_000);
    expect(() => resolveSession(created.token)).toThrow("Session expired");
    const locked = await (await get(created.token)).json();
    expect(locked.session.status).toBe("LOCKED");
    expect(locked.portfolio).toBeUndefined();
    const opened = await unlockAccount(created.account.id, "123456");
    expect(resolveSession(opened.token).id).toBe(created.account.id);
  });
  it("keeps concurrent signer contexts and read-only snapshots separate", async () => {
    const a = await createAgentAccount(
      "A",
      "OPERATOR",
      "123456",
      "CONSERVATIVE",
    );
    const b = await createAgentAccount("B", "OPERATOR", "654321", "AGGRESSIVE");
    const contexts = await Promise.all(
      [a, b].map((x) =>
        withAccount(resolveSession(x.token), async () => {
          await Promise.resolve();
          return currentAccountId();
        }),
      ),
    );
    expect(contexts).toEqual([a.account.id, b.account.id]);
    const snapshot = await (await get(a.token)).json();
    expect(snapshot.activeAccount.id).toBe(a.account.id);
    expect(snapshot.policy.tier1SingleTxMaxUsd).toBe(1);
    expect(
      snapshot.ledger.logs.every(
        (x: { accountId: string }) => x.accountId === a.account.id,
      ),
    ).toBe(true);
    expect(snapshot.verification.valid).toBe(true);
  });
});

describe("PIN step-up and policy enforcement", () => {
  it("preserves existing mixed-case mock blacklist addresses when saving settings", async () => {
    const entry = "0xBadC0de000000000000000000000000000000000";
    const response = await post({
      type: "policy",
      accountId: "master",
      pin: "884210",
      policy: { ...(await policy()), blacklistedAddresses: [entry] },
    });
    expect(response.status).toBe(200);
    expect((await policy()).blacklistedAddresses).toEqual([entry]);
  });
  it("requires the PIN for blacklist editing and applies the saved hard block", async () => {
    const p = { ...(await policy()), blacklistedAddresses: [destination] };
    expect(
      (await post({ type: "policy", accountId: "master", policy: p })).status,
    ).toBe(400);
    expect(
      (
        await post({
          type: "policy",
          accountId: "master",
          policy: p,
          pin: "884210",
        })
      ).status,
    ).toBe(200);
    expect((await policy()).blacklistedAddresses).toEqual([destination]);
    const result = await executeAction(action);
    expect(result.decision.tier).toBe("BLOCKED");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("streams execution progress through the same account and PIN boundary", async () => {
    const response = await POST(
      new NextRequest("http://localhost:3000/api/agent", {
        method: "POST",
        headers: {
          host: "localhost:3000",
          origin: "http://localhost:3000",
          Accept: "application/x-ndjson",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "intent",
          accountId: "master",
          prompt: "Analyze my on-chain portfolio and gas conditions",
        }),
      }),
    );
    expect(response.headers.get("content-type")).toContain(
      "application/x-ndjson",
    );
    const events = (await response.text())
      .trim()
      .split("\n")
      .map((x) => JSON.parse(x));
    expect(events[0]).toMatchObject({
      type: "progress",
      event: { stage: "policy", status: "success" },
    });
    expect(events.at(-1)).toMatchObject({
      type: "result",
      result: { balances: { ETH: "0.01" } },
    });
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("saves only the selected account policy with its own PIN", async () => {
    const created = await createAgentAccount(
      "Policy org",
      "OPERATOR",
      "123456",
    );
    const before = await policy();
    const response = await post(
      {
        type: "policy",
        accountId: created.account.id,
        pin: "123456",
        policy: { ...before, tier1SingleTxMaxUsd: 7 },
      },
      created.token,
    );
    expect(response.status).toBe(200);
    expect(await policy()).toEqual(before);
    expect(
      (await withAccount(resolveSession(created.token), () => policy()))
        .tier1SingleTxMaxUsd,
    ).toBe(7);
  });
  it("binds a valid PIN to the stored proposal rather than replacement action arguments", async () => {
    await executeAction(action);
    const id = (await ledger()).pending[0].id;
    await executeAction(
      {
        ...action,
        amount: "999",
        recipient: "0x2222222222222222222222222222222222222222",
      },
      false,
      id,
      "884210",
    );
    expect(mocks.send).toHaveBeenCalledWith({
      to: destination,
      value: parseUnits("3", 6),
    });
  });
  it("cannot save policy with a missing PIN and audits both failure and success", async () => {
    const p = {
      ...(await policy()),
      whitelistedAddresses: [destination],
      tier1SingleTxMaxUsd: 9,
    };
    const denied = await post({
      type: "policy",
      accountId: "master",
      policy: p,
    });
    expect(denied.status).toBe(400);
    expect((await policy()).tier1SingleTxMaxUsd).toBe(2);
    const allowed = await post({
      type: "policy",
      accountId: "master",
      policy: p,
      pin: "884210",
    });
    expect(allowed.status).toBe(200);
    expect((await policy()).tier1SingleTxMaxUsd).toBe(9);
    expect((await ledger()).logs.map((x) => x.status)).toContain(
      "TIER_2_AUTH_FAILED",
    );
    expect((await ledger()).logs.map((x) => x.status)).toContain(
      "TIER_2_AUTH_SUCCESS",
    );
  });
  it("refuses cross-account requests and approves only stored proposals after PIN verification", async () => {
    const a = await createAgentAccount("A", "OPERATOR", "123456");
    const b = await createAgentAccount("B", "OPERATOR", "654321");
    const context = resolveSession(a.token);
    await withAccount(context, () => executeAction(action));
    const proposal = (await ledger()).pending[0];
    await expect(
      withAccount(resolveSession(b.token), () =>
        decide(proposal.id, true, "654321"),
      ),
    ).rejects.toThrow("not found");
    await expect(
      withAccount(context, () => decide(proposal.id, true)),
    ).rejects.toThrow("Incorrect PIN");
    expect(mocks.send).not.toHaveBeenCalled();
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        withAccount(context, () => decide(proposal.id, true, "123456")),
      ),
    );
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    const bad = await post(
      { type: "intent", accountId: b.account.id, prompt: "portfolio" },
      a.token,
    );
    expect(bad.status).toBe(400);
    expect((await verifyLedger(await ledger())).valid).toBe(true);
  });
  it("keeps hard blocks final even after the correct PIN", async () => {
    await executeAction(action);
    const id = (await ledger()).pending[0].id;
    mocks.chainId.mockResolvedValue(1);
    const result = await decide(id, true, "884210");
    expect("decision" in result && result.decision.tier).toBe("BLOCKED");
    expect(mocks.send).not.toHaveBeenCalled();
  });
});

describe("Optional onboarding drip", () => {
  it("rejects attempts to invoke onboarding from an ordinary planner context", async () => {
    const created = await createAgentAccount(
      "Reserved account",
      "OPERATOR",
      "123456",
    );
    await expect(
      executeAction({
        kind: "fund_account",
        token: "ETH",
        amount: "0.0003",
        recipient: created.account.address,
        prompt: "Transfer to my new wallet",
      }),
    ).rejects.toThrow("server provisioning context");
    expect(mocks.send).not.toHaveBeenCalled();
    expect(
      (await listAccounts()).find((a) => a.id === created.account.id)?.drip
        .status,
    ).toBe("PENDING");
  });
  it("sends exactly 0.0003 ETH once and records the returned hash with reservation first", async () => {
    const a = await createAgentAccount("New account", "OPERATOR", "123456");
    await autoDrip(a.account);
    expect(mocks.send).toHaveBeenCalledWith({
      to: a.account.address,
      value: parseEther("0.0003"),
    });
    const funding = (await ledger()).logs.filter((x) =>
      x.intent.startsWith("ONBOARDING_GAS_DRIP"),
    );
    expect(funding.map((x) => x.status)).toEqual([
      "BROADCASTING",
      "SUBMITTED",
      "CONFIRMED",
    ]);
    expect(funding[0].txHash).toBeUndefined();
    expect(funding[1].txHash).toBe(`0x${"a".repeat(64)}`);
    await autoDrip(a.account);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(
      (await listAccounts()).find((x) => x.id === a.account.id)?.drip.status,
    ).toBe("CONFIRMED");
  });
  it("skips insufficient master reserves and never retries an unknown broadcast", async () => {
    const a = await createAgentAccount("No gas", "OPERATOR", "123456");
    mocks.balance.mockResolvedValue(parseEther("0.002"));
    await autoDrip(a.account);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(
      (await listAccounts()).find((x) => x.id === a.account.id)?.drip.status,
    ).toBe("SKIPPED");
    const b = await createAgentAccount("Unknown outcome", "OPERATOR", "123456");
    mocks.balance.mockResolvedValue(parseEther("0.003"));
    mocks.send.mockRejectedValue(new Error("connection dropped"));
    await autoDrip(b.account);
    await autoDrip(b.account);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(
      (await listAccounts()).find((x) => x.id === b.account.id)?.drip.status,
    ).toBe("UNRESOLVED");
  });
  it("respects the master daily budget rather than granting a faucet bypass", async () => {
    const a = await createAgentAccount("Budget test", "OPERATOR", "123456");
    await exclusive(async () =>
      saveJSON("policy.json", { ...(await policy()), tier1DailyLimitUsd: 0.5 }),
    );
    await autoDrip(a.account);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(
      (await listAccounts()).find((x) => x.id === a.account.id)?.drip.status,
    ).toBe("BLOCKED");
    expect((await ledger()).pending).toHaveLength(0);
  });
});
