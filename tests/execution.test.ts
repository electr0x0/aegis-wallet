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
  guardAddress: () => null,
  outerCall: (call: unknown) => call,
  decodeGuardError: () => null,
  signOwnerApproval: vi.fn(),
  portfolio: async () => ({ totalUsd: 0 }),
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
});
describe("Serialized execution and approval", () => {
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
