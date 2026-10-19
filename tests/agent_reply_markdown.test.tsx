// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  AgentReply,
  describeResult,
} from "../src/components/wallet/agent-reply";

afterEach(cleanup);

const plannerAnswer = [
  "I am an autonomous agent on the **Base Sepolia testnet**. My core use cases include:",
  "",
  "1. **Wallet & Portfolio Management:** Checking live balances (`get_wallet_portfolio`).",
  "2. **Token Transfers:** Moving ETH, WETH and USDC (`execute_token_transfer`).",
  "",
  "I operate under *deterministic* policies:",
  "- Simulation before execution",
  "- Hard blocks are final",
].join("\n");

function renderPlan(summary: string) {
  const reply = describeResult({ summary, results: [] });
  return render(<AgentReply reply={reply} />).container;
}

describe("Planner answers written in Markdown", () => {
  it("renders bold, code, italics and lists instead of raw markers", () => {
    const container = renderPlan(plannerAnswer);
    expect(container.textContent).not.toContain("**");
    expect(container.textContent).not.toContain("`");
    const bold = [...container.querySelectorAll("strong")].map(
      (node) => node.textContent,
    );
    expect(bold).toEqual([
      "Base Sepolia testnet",
      "Wallet & Portfolio Management:",
      "Token Transfers:",
    ]);
    expect(container.querySelector("em")?.textContent).toBe("deterministic");
    const code = [...container.querySelectorAll("code")].map(
      (node) => node.textContent,
    );
    expect(code).toEqual(["get_wallet_portfolio", "execute_token_transfer"]);
    expect(container.querySelectorAll("ol > li")).toHaveLength(2);
    expect(container.querySelectorAll("ul > li")).toHaveLength(2);
  });

  it("keeps model text inert: no HTML, no links", () => {
    const container = renderPlan(
      'Click <img src=x onerror="alert(1)"> or [claim](javascript:alert(1))',
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("<img src=x");
    expect(container.textContent).toContain("[claim](javascript:alert(1))");
  });

  it("leaves plain sentences and fixed stop messages unchanged", () => {
    const container = renderPlan("Planner stopped: TIER_2_HITL");
    const detail = container.querySelector(".agent-reply-detail");
    expect(detail?.textContent).toBe("Stopped to wait for your approval.");
  });
});
