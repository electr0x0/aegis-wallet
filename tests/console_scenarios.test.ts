import { describe, expect, it } from "vitest";
import { buildScenarios } from "../src/components/wallet/scenarios";
import type { LivePortfolio } from "../src/components/wallet/types";
import type { Policy } from "../src/lib/security/policyEngine";

const vault = "0x1111111111111111111111111111111111111111";
const policy: Policy = {
  tier1SingleTxMaxUsd: 2,
  tier1DailyLimitUsd: 5,
  maxGasGwei: 25,
  requireApproval: false,
  blacklistedAddresses: [],
  whitelistedAddresses: [vault],
};
const live: LivePortfolio = {
  address: vault,
  vault,
  mode: "eoa",
  gasGwei: 1,
  totalUsd: 2,
  balances: { ETH: "0.001", WETH: "0.0002", USDC: "0" },
};
const vaultChip = (p = live, rules = policy) =>
  buildScenarios(p, rules).find((x) => x.id === "vault")!;
describe("Balance-aware console scenarios", () => {
  it("chooses WETH then ETH when USDC is empty, using the whitelisted vault explicitly", () => {
    expect(vaultChip().prompt).toBe(`Send 0.0001 WETH to ${vault}`);
    expect(
      vaultChip({ ...live, balances: { ...live.balances, WETH: "0" } }).prompt,
    ).toBe(`Send 0.0001 ETH to ${vault}`);
    expect(
      vaultChip({ ...live, balances: { ...live.balances, USDC: "2" } }).prompt,
    ).toBe(`Send 1 USDC to ${vault}`);
  });
  it("uses partial USDC when no other asset is available and refuses missing funds or untrusted vaults", () => {
    expect(
      vaultChip({ ...live, balances: { ETH: "0", WETH: "0", USDC: "0.5" } })
        .prompt,
    ).toBe(`Send 0.5 USDC to ${vault}`);
    expect(
      vaultChip({ ...live, balances: { ETH: "0", WETH: "0", USDC: "0" } })
        .disabled,
    ).toBe(true);
    expect(
      vaultChip(live, { ...policy, whitelistedAddresses: [] }).disabled,
    ).toBe(true);
    expect(
      vaultChip(live, { ...policy, blacklistedAddresses: [vault] }).disabled,
    ).toBe(true);
    expect(
      buildScenarios(null, policy).find((x) => x.id === "vault")?.disabled,
    ).toBe(true);
  });
  it("keeps the requested wrap and external transfer amounts explicit", () => {
    const scenarios = buildScenarios(live, policy);
    expect(scenarios.find((x) => x.id === "wrap")?.prompt).toBe(
      "Wrap 0.0002 ETH into WETH",
    );
    expect(scenarios.find((x) => x.id === "external")?.prompt).toContain(
      "Send 0.005 ETH",
    );
  });
});
