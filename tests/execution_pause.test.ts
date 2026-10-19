import { expect, it } from "vitest";
import {
  evaluateTransactionPolicy,
  type Action,
  type Policy,
} from "../src/lib/security/policyEngine";
const recipient = "0x1111111111111111111111111111111111111111";
const p: Policy = {
  tier1SingleTxMaxUsd: 20,
  tier1DailyLimitUsd: 50,
  maxGasGwei: 25,
  whitelistedAddresses: [recipient],
  blacklistedAddresses: [],
  requireApproval: false,
  executionPaused: true,
};
const a: Action = {
  kind: "transfer_token",
  token: "USDC",
  amount: "1",
  recipient,
  prompt: "Pay the vault",
};
const c = { usd: 1, spentUsd: 0, gasGwei: 1, simulation: true };
it("pauses writes even when every autonomous condition passes", () => {
  expect(evaluateTransactionPolicy(a, p, c)).toMatchObject({
    tier: "BLOCKED",
    reasons: ["Local execution is paused by the operator"],
  });
  expect(
    evaluateTransactionPolicy({ ...a, kind: "anchor_ledger" }, p, c).tier,
  ).toBe("BLOCKED");
  expect(
    evaluateTransactionPolicy({ ...a, kind: "fund_account" }, p, c).tier,
  ).toBe("BLOCKED");
});
it("keeps reads available and resumes only under the current policy", () => {
  expect(
    evaluateTransactionPolicy({ ...a, kind: "read" }, p, {
      ...c,
      simulation: false,
    }).tier,
  ).toBe("TIER_0");
  expect(
    evaluateTransactionPolicy(
      a,
      { ...p, executionPaused: false, requireApproval: true },
      c,
    ).tier,
  ).toBe("TIER_2_HITL");
  expect(
    evaluateTransactionPolicy(
      a,
      { ...p, executionPaused: false },
      { ...c, simulation: false },
    ).tier,
  ).toBe("BLOCKED");
});
