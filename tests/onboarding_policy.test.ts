import { describe, expect, it } from "vitest";
import {
  evaluateTransactionPolicy,
  type Action,
  type Policy,
  type PolicyContext,
} from "../src/lib/security/policyEngine";

const recipient = "0x1111111111111111111111111111111111111111";
const action: Action = {
  kind: "fund_account",
  token: "ETH",
  amount: "0.0003",
  recipient,
  prompt: "ONBOARDING_GAS_DRIP",
};
const policy: Policy = {
  tier1SingleTxMaxUsd: 2,
  tier1DailyLimitUsd: 5,
  maxGasGwei: 25,
  whitelistedAddresses: [],
  blacklistedAddresses: [],
  requireApproval: false,
};
const context: PolicyContext = {
  usd: 0.75,
  spentUsd: 0,
  gasGwei: 1,
  simulation: true,
  onboardingRecipient: recipient,
};
describe("One-time onboarding policy capability", () => {
  it("allows only a reserved, exact ETH drip and preserves ordinary recipient checks", () => {
    expect(evaluateTransactionPolicy(action, policy, context).tier).toBe(
      "TIER_1_AUTO",
    );
    expect(
      evaluateTransactionPolicy(
        { ...action, kind: "transfer_token" },
        policy,
        context,
      ).tier,
    ).toBe("TIER_2_HITL");
    expect(
      evaluateTransactionPolicy(action, policy, {
        ...context,
        onboardingRecipient: undefined,
      }).tier,
    ).toBe("BLOCKED");
    expect(
      evaluateTransactionPolicy({ ...action, amount: "1" }, policy, context)
        .tier,
    ).toBe("BLOCKED");
    expect(
      evaluateTransactionPolicy({ ...action, token: "USDC" }, policy, context)
        .tier,
    ).toBe("BLOCKED");
  });
  it("cannot bypass blacklist, failed simulation, gas, budgets, or runway", () => {
    expect(
      evaluateTransactionPolicy(
        action,
        { ...policy, blacklistedAddresses: [recipient] },
        context,
      ).tier,
    ).toBe("BLOCKED");
    expect(
      evaluateTransactionPolicy(action, policy, {
        ...context,
        simulation: false,
      }).tier,
    ).toBe("BLOCKED");
    expect(
      evaluateTransactionPolicy(action, policy, { ...context, gasGwei: 26 })
        .tier,
    ).toBe("BLOCKED");
    expect(
      evaluateTransactionPolicy(action, policy, { ...context, spentUsd: 5 })
        .tier,
    ).toBe("TIER_2_HITL");
    expect(
      evaluateTransactionPolicy(
        action,
        {
          ...policy,
          treasury: {
            fiatReserveUsd: 0,
            monthlyExpensesUsd: 1,
            minRunwayMonths: 3,
          },
        },
        { ...context, holdingsUsd: 3 },
      ).tier,
    ).toBe("TIER_2_HITL");
  });
});
