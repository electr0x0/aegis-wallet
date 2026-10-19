import { BaseError } from "viem";
import { beforeEach, describe, it, expect, vi } from "vitest";
import type { Ledger } from "../src/lib/store";
import type { Policy, Action } from "../src/lib/security/policyEngine";
const mocks = vi.hoisted(() => ({
  state: { logs: [], pending: [] } as Ledger,
  p: {
    tier1SingleTxMaxUsd: 2,
    tier1DailyLimitUsd: 5,
    maxGasGwei: 25,
    whitelistedAddresses: ["0x1111111111111111111111111111111111111111"],
    blacklistedAddresses: ["0x000000000000000000000000000000000000dead"],
    requireApproval: false,
  } as Policy,
  send: vi.fn(),
  simulate: vi.fn(),
  balance: vi.fn(),
  portfolio: vi.fn(),
}));
// PIN persistence and enforcement are exercised with the real account store in accounts.test.ts.
vi.mock("../src/lib/auth/accountStore", () => ({
  requireStepUp: vi.fn(),
  claimDrip: vi.fn(),
  setDrip: vi.fn(),
  withMasterFunding: (fn: () => unknown) => fn(),
}));
vi.mock("../src/lib/chain", () => ({
  WETH: "0x4200000000000000000000000000000000000006",
  USDC: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  account: () => ({ address: "0x1111111111111111111111111111111111111111" }),
  wallet: () => ({ sendTransaction: mocks.send }),
  transaction: () => ({
    to: "0x1111111111111111111111111111111111111111",
    value: 0n,
  }),
  holderAddress: () => "0x1111111111111111111111111111111111111111",
  holderBalance: mocks.balance,
  tokenDecimals: (token: string) => (token === "USDC" ? 6 : 18),
  guardAddress: () => null,
  outerCall: (call: unknown) => call,
  decodeGuardError: () => null,
  signOwnerApproval: vi.fn(),
  portfolio: mocks.portfolio,
  publicClient: {
    getChainId: async () => 84532,
    estimateGas: mocks.simulate,
    getGasPrice: async () => 1000000000n,
    call: async () => ({ data: "0x01" }),
    waitForTransactionReceipt: async () => ({ status: "success" }),
  },
}));
vi.mock("../src/lib/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/store")>();
  return {
    ...original,
    ledger: async () => structuredClone(mocks.state),
    policy: async () => structuredClone(mocks.p),
    saveJSON: async (_name: string, value: Ledger) => {
      mocks.state = structuredClone(value);
    },
    saveLedger: async (value: Ledger) => {
      mocks.state = structuredClone(value);
    },
  };
});
import { executeAction, decide } from "../src/lib/agent/tools";
import {
  withExecutionProgress,
  type ExecutionProgress,
} from "../src/lib/agent/progress";
const action: Action = {
  kind: "transfer_token",
  token: "USDC",
  amount: "0.50",
  recipient: "0x1111111111111111111111111111111111111111",
  prompt: "Transfer 0.50 USDC",
};
beforeEach(() => {
  mocks.state = { logs: [], pending: [] };
  mocks.p.tier1DailyLimitUsd = 5;
  mocks.p.requireApproval = false;
  mocks.send.mockReset().mockResolvedValue("0x" + "a".repeat(64));
  mocks.simulate.mockReset().mockResolvedValue(21000n);
  mocks.balance.mockReset().mockResolvedValue(10n ** 30n);
  mocks.portfolio.mockReset().mockResolvedValue({ totalUsd: 0 });
});
describe("Serialized execution and approval", () => {
  it("rechecks persistent mandate gas constraints when a human later approves", async () => {
    const { policyHash } = await import("../src/lib/store");
    mocks.p.requireApproval = true;
    const live = {
      balances: { ETH: "0.01", WETH: "0", USDC: "10" },
      totalUsd: 35,
      agentGasEth: "0.01",
      gasGwei: 1,
      vault: action.recipient,
      mode: "eoa",
    };
    mocks.portfolio.mockResolvedValue(live);
    await executeAction(action, false, undefined, undefined, false, {
      settings: { maxSweepUsd: "1", gasReserveEth: "0.001", asset: "USDC" },
      policyHash: policyHash(mocks.p),
      expiresAt: Date.now() + 60000,
    });
    expect(mocks.state.pending[0].mandate).toBeDefined();
    mocks.portfolio.mockResolvedValue({ ...live, agentGasEth: "0.00001" });
    await decide(mocks.state.pending[0].id, true);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.state.pending[0].status).toBe("BLOCKED");
  });
  it("invalidates a mandate when policy changes or its review window expires", async () => {
    const { policyHash } = await import("../src/lib/store");
    const constraint = {
      settings: {
        maxSweepUsd: "1",
        gasReserveEth: "0.001",
        asset: "USDC" as const,
      },
      policyHash: policyHash(mocks.p),
      expiresAt: Date.now() + 60000,
    };
    mocks.p.tier1DailyLimitUsd = 4;
    expect(
      (
        await executeAction(
          action,
          false,
          undefined,
          undefined,
          false,
          constraint,
        )
      ).decision.tier,
    ).toBe("BLOCKED");
    expect(
      (
        await executeAction(action, false, undefined, undefined, false, {
          ...constraint,
          policyHash: policyHash(mocks.p),
          expiresAt: 0,
        })
      ).decision.tier,
    ).toBe("BLOCKED");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("reports actual stages and returned hashes while isolating disconnected observers", async () => {
    const events: ExecutionProgress[] = [];
    await withExecutionProgress(
      (event) => events.push(event),
      () => executeAction(action),
    );
    expect(
      events.filter((x) => x.stage === "simulation").map((x) => x.status),
    ).toEqual(["running", "success"]);
    expect(
      events.filter((x) => x.stage === "broadcast").map((x) => x.status),
    ).toEqual(["running", "submitted", "success"]);
    expect(events.find((x) => x.status === "submitted")?.txHash).toBe(
      `0x${"a".repeat(64)}`,
    );
    mocks.send.mockClear();
    await withExecutionProgress(
      () => {
        throw new Error("UI disconnected");
      },
      () => executeAction(action),
    );
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it("never reports simulation or broadcast after a pre-RPC hard block", async () => {
    const events: ExecutionProgress[] = [];
    await withExecutionProgress(
      (event) => events.push(event),
      () =>
        executeAction({
          ...action,
          recipient: "0x000000000000000000000000000000000000dead",
        }),
    );
    expect(events.map((x) => x.stage)).toEqual(["policy", "policy"]);
    expect(events.at(-1)?.status).toBe("failed");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("prevents concurrent writes from exceeding the autonomous budget", async () => {
    mocks.p.tier1DailyLimitUsd = 0.5;
    await Promise.all([executeAction(action), executeAction(action)]);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.state.pending).toHaveLength(1);
    expect(mocks.state.logs.map((x) => x.status)).toEqual([
      "BROADCASTING",
      "SUBMITTED",
      "CONFIRMED",
      "AWAITING_HITL_APPROVAL",
    ]);
  });
  it("broadcasts a proposal at most once under concurrent approvals", async () => {
    mocks.p.requireApproval = true;
    await executeAction(action);
    const id = mocks.state.pending[0].id;
    const results = await Promise.allSettled([
      decide(id, true),
      decide(id, true),
    ]);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(results.filter((x) => x.status === "rejected")).toHaveLength(1);
  });
  it("rechecks simulation at approval time", async () => {
    mocks.p.requireApproval = true;
    await executeAction(action);
    mocks.simulate.mockRejectedValue(new Error("execution reverted"));
    await decide(mocks.state.pending[0].id, true);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.state.pending[0].status).toBe("BLOCKED");
  });
  it("records an insufficient balance as one readable sentence", async () => {
    mocks.simulate.mockRejectedValue(
      new Error(
        "Transaction creation failed.\n\nURL: https://sepolia.base.org",
      ),
    );
    mocks.balance.mockResolvedValue(800_000_000_000_000n);
    const result = await executeAction({
      ...action,
      kind: "wrap_eth",
      token: "ETH",
      amount: "0.001",
      prompt: "Wrap 0.001 ETH into WETH",
    });
    const reason =
      "Insufficient ETH: the wallet holds 0.0008 ETH, this needs 0.001 ETH.";
    expect(result.decision.tier).toBe("BLOCKED");
    expect(result.error).toBe(reason);
    expect(mocks.state.logs.at(-1)?.simulation).toBe(reason);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("keeps a failed simulation blocked when viem gives no message", async () => {
    const bare = Object.assign(new BaseError("wrapped"), {
      shortMessage: undefined,
      details: "",
    });
    mocks.simulate.mockRejectedValue(bare);
    const result = await executeAction(action);
    expect(result.decision.tier).toBe("BLOCKED");
    expect(result.error).not.toBe("");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("dry runs never sign or enqueue approvals", async () => {
    await executeAction({ ...action, amount: "5" }, true);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.state.pending).toHaveLength(0);
    expect(mocks.state.logs[0].status).toBe("DRY_RUN");
  });
  it("reserves uncertain broadcasts and does not retry automatically", async () => {
    mocks.p.tier1DailyLimitUsd = 0.5;
    mocks.send.mockRejectedValueOnce(new Error("transport dropped"));
    await expect(executeAction(action)).rejects.toThrow("unresolved");
    await executeAction(action);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.state.pending).toHaveLength(1);
  });
});
