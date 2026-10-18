// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApprovalCard } from "../src/components/wallet/approval-card";
import { PromptComposer } from "../src/components/godui/prompt-composer";
import type { Proposal } from "../src/lib/store";

afterEach(cleanup);
const proposal: Proposal = {
  id: "test-proposal",
  action: {
    kind: "transfer_token",
    token: "USDC",
    amount: "5.00",
    recipient: "0x1111111111111111111111111111111111111111",
    prompt: "Pay supplier",
  },
  decision: {
    tier: "TIER_2_HITL",
    reasons: ["Recipient is not whitelisted"],
    riskScore: 65,
  },
  gasEstimate: "51000",
  usd: 5,
  status: "AWAITING_HITL_APPROVAL",
};

describe("GodUI approval integration", () => {
  it("reviews full transaction details without authorizing on an ordinary click", async () => {
    const onDecide = vi.fn().mockResolvedValue(undefined);
    render(
      <ApprovalCard proposal={proposal} busy={false} onDecide={onDecide} />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Review & approve" }),
    );
    expect(screen.getByRole("alertdialog").textContent).toContain(
      proposal.action.recipient,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Approve & broadcast" }),
    );
    expect(onDecide).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onDecide).not.toHaveBeenCalled();
  });
  it("cancels a short hold but authorizes once after a complete hold", async () => {
    const onDecide = vi.fn().mockResolvedValue(undefined);
    render(
      <ApprovalCard proposal={proposal} busy={false} onDecide={onDecide} />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Review & approve" }),
    );
    const confirm = screen.getByRole("button", {
      name: "Approve & broadcast",
    });
    fireEvent.keyDown(confirm, { key: " " });
    fireEvent.keyUp(confirm, { key: " " });
    expect(onDecide).not.toHaveBeenCalled();
    fireEvent.keyDown(confirm, { key: "Enter" });
    await waitFor(
      () => expect(onDecide).toHaveBeenCalledWith("test-proposal", true),
      { timeout: 2500 },
    );
    expect(onDecide).toHaveBeenCalledTimes(1);
  });
  it("routes rejection independently and disables review while busy", async () => {
    const onDecide = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <ApprovalCard proposal={proposal} busy={false} onDecide={onDecide} />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Reject" }),
    );
    expect(onDecide).toHaveBeenCalledWith("test-proposal", false);
    rerender(<ApprovalCard proposal={proposal} busy onDecide={onDecide} />);
    expect(
      (
        screen.getByRole("button", {
          name: "Review & approve",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});

describe("Text-only GodUI composer", () => {
  it("hides unsupported attachments and respects the backend character limit", async () => {
    const onSend = vi.fn();
    render(
      <PromptComposer allowAttachments={false} maxLength={4} onSend={onSend} />,
    );
    expect(document.querySelector("input[type=file]")).toBeNull();
    await userEvent.type(
      screen.getByRole("textbox", { name: "Prompt" }),
      "abcdef",
    );
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "abcd",
    );
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(onSend).toHaveBeenCalledWith("abcd", []);
  });
  it("does not submit or pretend to cancel when an operation is busy", async () => {
    const onSend = vi.fn();
    render(
      <PromptComposer
        allowAttachments={false}
        defaultValue="inspect portfolio"
        disabled
        onSend={onSend}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Stop generating" }),
    ).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(onSend).not.toHaveBeenCalled();
  });
});
