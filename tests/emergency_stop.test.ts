// Offline: the chain is mocked. Covers the decision logic behind pnpm guard:deploy --revoke and
// --renew. Nothing is signed for real and no RPC is contacted.
import { encodeFunctionData, formatEther, zeroAddress, type Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import artifact from "../src/lib/guard/AgentGuard.json";

const GUARD = "0xe05aec8cd8cd122f0988ba835670f64171453a31";
const OWNER = "0xf0841Df896811a10E31ae27506FD1A074eC605Ef";
const AGENT = "0xE1f4D11f3170Bd994379eA5f7443d826BC3ABd9F";
const MAX_FEE = 7_000_000n;
const GAS_BUDGET = 150_000n * MAX_FEE;
const EXPIRY = 1_900_000_000n;
const RELAYED = "0x00c0ffee";
const FUNDED = 10n ** 16n;

const mocks = vi.hoisted(() => ({
  sessionKey: "" as string,
  onChainOwner: "" as string,
  balances: {} as Record<string, bigint>,
  estimateGas: vi.fn(),
  signOwnerApproval: vi.fn(),
  outerCall: vi.fn(),
}));

vi.mock("../src/lib/chain", () => ({
  guardAbi: artifact.abi,
  account: () => ({ address: AGENT }),
  decodeGuardError: (e: { guardError?: string }) => e.guardError ?? null,
  outerCall: mocks.outerCall,
  signOwnerApproval: mocks.signOwnerApproval,
  publicClient: {
    readContract: async ({ functionName }: { functionName: string }) =>
      functionName === "owner" ? mocks.onChainOwner : mocks.sessionKey,
    getBalance: async ({ address }: { address: string }) =>
      mocks.balances[address] ?? 0n,
    estimateFeesPerGas: async () => ({
      maxFeePerGas: MAX_FEE,
      maxPriorityFeePerGas: 1_000_000n,
    }),
    estimateGas: mocks.estimateGas,
  },
}));

import {
  chooseSessionPath,
  prepareSessionChange,
} from "../scripts/guard-session";

const revokeData = encodeFunctionData({
  abi: artifact.abi,
  functionName: "revokeSession",
});
const renewData = encodeFunctionData({
  abi: artifact.abi,
  functionName: "setSession",
  args: [AGENT, EXPIRY],
});

function prepare(op: "revoke" | "renew") {
  return prepareSessionChange(op, {
    guard: GUARD,
    owner: OWNER,
    expiry: EXPIRY,
  });
}

function liveSession() {
  mocks.sessionKey = AGENT;
}

function revokedSession() {
  mocks.sessionKey = zeroAddress;
}

beforeEach(() => {
  mocks.onChainOwner = OWNER;
  mocks.balances = { [AGENT]: FUNDED, [OWNER]: 0n };
  mocks.estimateGas.mockReset().mockResolvedValue(30_000n);
  mocks.signOwnerApproval.mockReset().mockResolvedValue({
    nonce: 1n,
    deadline: 2n,
    signature: "0x01",
  });
  mocks.outerCall.mockReset().mockImplementation((inner: { to: Hex }) => ({
    to: inner.to,
    value: 0n,
    data: RELAYED,
  }));
});

describe("emergency stop: revoke (offline, mocked chain)", () => {
  it("lets a funded owner revoke directly, without the agent key", async () => {
    liveSession();
    mocks.balances[OWNER] = FUNDED;

    const change = await prepare("revoke");

    expect(change.path).toBe("owner");
    expect(change.payer).toBe(OWNER);
    expect(change.call).toEqual({ to: GUARD, value: 0n, data: revokeData });
    expect(mocks.signOwnerApproval).not.toHaveBeenCalled();
    expect(mocks.estimateGas).toHaveBeenCalledWith({
      to: GUARD,
      value: 0n,
      data: revokeData,
      account: OWNER,
    });
    expect(change.reasons[0]).toContain(`cleared session key ${AGENT}`);
    expect(change.warnings).toEqual([]);
  });

  it("relays an owner-signed revoke through the session key when the owner has no gas", async () => {
    liveSession();

    const change = await prepare("revoke");

    expect(change.path).toBe("relay");
    expect(change.payer).toBe(AGENT);
    expect(mocks.signOwnerApproval).toHaveBeenCalledWith({
      to: GUARD,
      value: 0n,
      data: revokeData,
    });
    expect(change.call.data).toBe(RELAYED);
    expect(mocks.estimateGas.mock.calls[0][0].account).toBe(AGENT);
    // The owner will be the only key able to renew, and it has nothing to pay with.
    expect(change.warnings).toHaveLength(1);
    expect(change.warnings[0]).toContain(OWNER);
    expect(change.warnings[0]).toContain("--renew");
  });

  it("refuses when the session is already revoked", async () => {
    revokedSession();
    mocks.balances[OWNER] = FUNDED;

    await expect(prepare("revoke")).rejects.toThrow(/already revoked/);
    expect(mocks.estimateGas).not.toHaveBeenCalled();
  });

  it("refuses to send when the simulation fails", async () => {
    liveSession();
    mocks.balances[OWNER] = FUNDED;
    mocks.estimateGas.mockRejectedValue(
      Object.assign(new Error("execution reverted"), {
        guardError: "On-chain guard rejected: NotOwner",
      }),
    );

    await expect(prepare("revoke")).rejects.toThrow(
      "revokeSession failed in simulation, so nothing was sent: On-chain guard rejected: NotOwner",
    );
  });

  it("refuses when VAULT_PRIVATE_KEY is not the guard owner", async () => {
    liveSession();
    mocks.onChainOwner = "0x000000000000000000000000000000000000beef";

    await expect(prepare("revoke")).rejects.toThrow(/not the owner/);
    expect(mocks.estimateGas).not.toHaveBeenCalled();
  });
});

describe("renew before and after a revoke (offline, mocked chain)", () => {
  it("keeps the owner-signed relay while the agent is still the session key", async () => {
    liveSession();

    const change = await prepare("renew");

    expect(change.path).toBe("relay");
    expect(change.payer).toBe(AGENT);
    expect(mocks.signOwnerApproval).toHaveBeenCalledWith({
      to: GUARD,
      value: 0n,
      data: renewData,
    });
    expect(change.warnings).toEqual([]);
  });

  it("has the owner send setSession itself after a revoke", async () => {
    revokedSession();
    mocks.balances[OWNER] = FUNDED;

    const change = await prepare("renew");

    expect(change.path).toBe("owner");
    expect(change.payer).toBe(OWNER);
    expect(change.call).toEqual({ to: GUARD, value: 0n, data: renewData });
    expect(mocks.signOwnerApproval).not.toHaveBeenCalled();
    expect(mocks.estimateGas.mock.calls[0][0].account).toBe(OWNER);
    expect(change.reasons[1]).toContain(`directly by owner ${OWNER}`);
  });

  it("names the owner address and the ETH it needs when it cannot pay after a revoke", async () => {
    revokedSession();

    const failure = prepare("renew");

    await expect(failure).rejects.toThrow(/session is revoked/);
    await expect(failure).rejects.toThrow(
      `fund owner ${OWNER} (has 0 ETH) with at least ${formatEther(GAS_BUDGET)} ETH`,
    );
    expect(mocks.signOwnerApproval).not.toHaveBeenCalled();
    expect(mocks.estimateGas).not.toHaveBeenCalled();
  });
});

describe("chooseSessionPath (offline, pure)", () => {
  const state = {
    agent: AGENT as Hex,
    owner: OWNER as Hex,
    sessionKey: AGENT as Hex,
    agentBalance: FUNDED,
    ownerBalance: 0n,
    gasBudget: GAS_BUDGET,
  };

  it("falls back to the owner when the agent cannot pay for a renewal", () => {
    const plan = chooseSessionPath("renew", {
      ...state,
      agentBalance: 0n,
      ownerBalance: FUNDED,
    });
    expect(plan).toEqual({ path: "owner", payer: OWNER });
  });

  it("never relays through a session key that is not the agent", () => {
    const other = "0x000000000000000000000000000000000000c0de";
    expect(() =>
      chooseSessionPath("revoke", { ...state, sessionKey: other }),
    ).toThrow(`The session key is ${other}, not the agent`);
  });

  it("names both keys when neither can pay", () => {
    expect(() =>
      chooseSessionPath("revoke", { ...state, agentBalance: 0n }),
    ).toThrow(`Fund owner ${OWNER} (has 0 ETH) or agent ${AGENT} (has 0 ETH)`);
  });
});
