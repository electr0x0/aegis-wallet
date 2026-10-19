import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  execute: vi.fn(async (_action: unknown, ..._args: unknown[]) => ({
    status: "TEST_ONLY",
  })),
  chain: vi.fn(async () => 84532),
}));
vi.mock("../src/lib/agent/tools", () => ({ executeAction: mocks.execute }));
vi.mock("../src/lib/chain", () => ({
  publicClient: { getChainId: mocks.chain },
  portfolio: async () => ({
    balances: { ETH: "1", USDC: "10", WETH: "0" },
    agentGasEth: "1",
    mode: "eoa",
    vault: "0x1111111111111111111111111111111111111111",
    gasGwei: 1,
  }),
}));
vi.mock("../src/lib/store", () => ({
  ledger: async () => ({ logs: [] }),
  policyHash: () => "test-policy",
  policy: async () => ({
    tier1SingleTxMaxUsd: 2,
    tier1DailyLimitUsd: 5,
    maxGasGwei: 25,
    requireApproval: false,
    whitelistedAddresses: ["0x1111111111111111111111111111111111111111"],
    blacklistedAddresses: [],
  }),
}));
import { previewMandate, executeMandate } from "../src/lib/treasury/mandates";
import { withAccount } from "../src/lib/auth/context";
const settings = { maxSweepUsd: "1", gasReserveEth: "0.001", asset: "AUTO" };
afterEach(() => {
  vi.useRealTimers();
  mocks.execute.mockClear();
  mocks.chain.mockResolvedValue(84532);
});
it("quotes one server-owned action and consumes its ID before a duplicate execution", async () => {
  const preview = await previewMandate(settings);
  expect(preview.id).toBeTruthy();
  expect(mocks.execute).not.toHaveBeenCalled();
  const results = await Promise.allSettled([
    executeMandate(preview.id!),
    executeMandate(preview.id!),
  ]);
  expect(mocks.execute).toHaveBeenCalledTimes(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  expect(mocks.execute.mock.calls[0][0]).toMatchObject({
    amount: "1",
    token: "USDC",
  });
});
it("rejects expired and cross-account previews without consuming another account's quote", async () => {
  const preview = await previewMandate(settings);
  await expect(
    withAccount({ id: "other", key: `0x${"1".repeat(64)}`, guard: false }, () =>
      executeMandate(preview.id!),
    ),
  ).rejects.toThrow("another account");
  vi.useFakeTimers();
  vi.setSystemTime(preview.expiresAt + 1);
  await expect(executeMandate(preview.id!)).rejects.toThrow("expired");
  expect(mocks.execute).not.toHaveBeenCalled();
});
it("refuses previews on another chain", async () => {
  mocks.chain.mockResolvedValue(1);
  await expect(previewMandate(settings)).rejects.toThrow("84532");
});
