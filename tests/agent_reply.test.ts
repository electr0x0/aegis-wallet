import { describe, expect, it } from "vitest";
import {
  describeError,
  describeResult,
} from "../src/components/wallet/agent-reply";

const blockedWrap = {
  decision: {
    tier: "BLOCKED",
    reasons: ["Pre-flight simulation failed"],
    riskScore: 100,
  },
  usd: 2.5,
  gasEstimate: "0",
  error: "Insufficient ETH: the wallet holds 0.0008 ETH, this needs 0.001 ETH.",
  rationale:
    "BLOCKED: wrap 0.001 ETH (~$2.50). Blocked: Pre-flight simulation failed. Nothing was signed.",
};

describe("Readable agent replies", () => {
  it("explains a blocked wrap with its cause and a fix", () => {
    const reply = describeResult(blockedWrap);
    expect(reply.tone).toBe("error");
    expect(reply.title).toBe("Blocked. Nothing was signed.");
    expect(reply.detail).toBe(
      "Pre-flight simulation failed. Insufficient ETH: the wallet holds 0.0008 ETH, this needs 0.001 ETH.",
    );
    expect(reply.note).toBe("Fund the wallet or try a smaller amount.");
  });

  it("links a confirmed transaction and drops the tier code", () => {
    const reply = describeResult({
      ...blockedWrap,
      decision: { tier: "TIER_1_AUTO", reasons: [], riskScore: 15 },
      error: "",
      rationale: "TIER_1_AUTO: wrap 0.0005 ETH (~$1.25). Within $2.00 cap.",
      txHash: "0x" + "a".repeat(64),
      status: "CONFIRMED",
    });
    expect(reply.tone).toBe("success");
    expect(reply.txHash).toBe("0x" + "a".repeat(64));
    expect(reply.detail).toBe("Wrap 0.0005 ETH (~$1.25). Within $2.00 cap.");
  });

  it("asks for approval on a held proposal and summarises plans", () => {
    const held = {
      ...blockedWrap,
      decision: {
        tier: "TIER_2_HITL",
        reasons: ["Recipient is not whitelisted"],
        riskScore: 65,
      },
      error: "",
      proposalId: "p1",
    };
    expect(describeResult(held).title).toBe("Waiting for your approval");
    const plan = describeResult({
      summary: "Planner stopped: TIER_2_HITL",
      results: [held],
    });
    expect(plan).toMatchObject({
      tone: "pending",
      title: "Ran 1 step",
      detail: "Stopped to wait for your approval.",
    });
  });

  it("turns a refusal into a plain statement", () => {
    const reply = describeError("Refused: instruction-override language.");
    expect(reply.title).toBe("Refused. Nothing was signed.");
  });
});
