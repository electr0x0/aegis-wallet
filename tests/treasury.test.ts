import { describe, expect, it } from "vitest";
import { parseUnits } from "viem";
import {
  calculateSweep,
  decimalUnits,
  mandateSchema,
  spentUnits,
  type TreasuryFacts,
} from "../src/lib/treasury/calculate";
import type { Policy } from "../src/lib/security/policyEngine";
const vault = "0x1111111111111111111111111111111111111111";
const settings = {
  maxSweepUsd: "10",
  gasReserveEth: "0.001",
  asset: "AUTO" as const,
};
const policy: Policy = {
  tier1SingleTxMaxUsd: 5,
  tier1DailyLimitUsd: 20,
  maxGasGwei: 25,
  whitelistedAddresses: [vault],
  blacklistedAddresses: [],
  requireApproval: false,
};
const facts: TreasuryFacts = {
  balances: { USDC: "100", WETH: "0.2", ETH: "0.01" },
  agentGasEth: "0.01",
  mode: "eoa",
  vault,
  gasGwei: 1,
};
describe("Treasury mandate integer calculations", () => {
  it("rounds a sub-microdollar fee liability up before permitting a runway surplus", () => {
    const p = {
      ...policy,
      treasury: {
        fiatReserveUsd: 0,
        monthlyExpensesUsd: 1,
        minRunwayMonths: 1,
      },
    };
    const result = calculateSweep(
      settings,
      {
        ...facts,
        gasGwei: 0.000000001,
        mode: "guard",
        balances: { ETH: "0", WETH: "0", USDC: "1.000001" },
      },
      p,
      0n,
    );
    expect(result.action).toBeNull();
    expect(
      result.limits.find((l) => l.label === "Surplus above runway floor")?.usd,
    ).toBe("0");
  });
  it("takes the most restrictive requested, single and remaining daily limit", () => {
    const sweep = calculateSweep(
      settings,
      facts,
      policy,
      parseUnits("18.75", 6),
    );
    expect(sweep.action).toMatchObject({
      kind: "transfer_token",
      token: "USDC",
      amount: "1.25",
      recipient: vault,
    });
    expect(
      calculateSweep(
        { ...settings, maxSweepUsd: "0.000001" },
        facts,
        policy,
        0n,
      ).action?.amount,
    ).toBe("0.000001");
  });
  it("uses WETH or ETH when stablecoin is absent, retaining EOA gas plus fee buffer", () => {
    expect(
      calculateSweep(
        settings,
        { ...facts, balances: { ...facts.balances, USDC: "0" } },
        policy,
        0n,
      ).action?.token,
    ).toBe("WETH");
    const eth = calculateSweep(
      { ...settings, asset: "ETH" },
      {
        ...facts,
        balances: { ETH: "0.002", USDC: "0", WETH: "0" },
        agentGasEth: "0.002",
      },
      policy,
      0n,
    );
    expect(eth.action?.amount).toBe("0.0004");
    expect(eth.projectedFeeEth).toBe("0.0006");
  });
  it("uses the agent's separate gas balance in guard mode", () => {
    const guarded = {
      ...facts,
      mode: "guard" as const,
      balances: { ...facts.balances, ETH: "1" },
      agentGasEth: "0.0001",
    };
    expect(calculateSweep(settings, guarded, policy, 0n).action).toBeNull();
  });
  it("preserves runway, not just token balances", () => {
    const p = {
      ...policy,
      treasury: {
        fiatReserveUsd: 8990,
        monthlyExpensesUsd: 3000,
        minRunwayMonths: 3,
      },
    };
    expect(
      calculateSweep(
        settings,
        {
          ...facts,
          balances: { USDC: "1", WETH: "0", ETH: "0.002" },
          agentGasEth: "0.002",
        },
        p,
        0n,
      ).action,
    ).toBeNull();
    const eligible = calculateSweep(settings, facts, p, 0n);
    expect(eligible.action?.amount).toBe("5");
  });
  it.each([
    { ...policy, executionPaused: true },
    { ...policy, whitelistedAddresses: [] },
    { ...policy, blacklistedAddresses: [vault] },
    { ...policy, tier1DailyLimitUsd: 0 },
  ])("refuses an unavailable mandate", (p) =>
    expect(calculateSweep(settings, facts, p, 0n).action).toBeNull(),
  );
  it("rounds liabilities up and caps down without floating-point arithmetic", () => {
    expect(decimalUnits(1e-8, 6)).toBe(0n);
    expect(decimalUnits(1e-8, 6, true)).toBe(1n);
    expect(decimalUnits("1.23456789", 6)).toBe(1234567n);
    expect(() => decimalUnits(Infinity, 6)).toThrow();
    expect(
      mandateSchema.safeParse({ ...settings, maxSweepUsd: "1e3" }).success,
    ).toBe(false);
  });
  it("deduplicates status history and isolates the rolling account budget", () => {
    const base = {
      id: "x",
      operationId: "one",
      timestamp: new Date().toISOString(),
      tier: "TIER_1_AUTO",
      status: "SUBMITTED",
      usd: 1,
    };
    expect(
      spentUnits(
        [
          base,
          { ...base, id: "y", status: "CONFIRMED" },
          { ...base, id: "z", accountId: "other", usd: 20 },
        ],
        "master",
      ),
    ).toBe(1_000000n);
    expect(
      spentUnits([{ ...base, timestamp: "2000-01-01T00:00:00Z" }], "master"),
    ).toBe(0n);
  });
});
