// @vitest-environment jsdom
import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EvidenceView } from "../src/components/wallet/console-views";
import { ExecutionSteps } from "../src/components/wallet/execution-steps";
import type { Entry } from "../src/lib/store";

// UI fixtures only; no network, signing or live-evidence files are used.
const state = vi.hoisted(() => ({
  logs: [] as Entry[],
  exportEvidence: vi.fn(),
}));
vi.mock("../src/components/wallet/wallet-provider", () => ({
  useWallet: () => ({
    snapshot: { ledger: { logs: state.logs } },
    exportEvidence: state.exportEvidence,
  }),
}));
afterEach(cleanup);

it("combines Lab tier and status facets without treating submitted evidence as confirmed", async () => {
  const base = {
    timestamp: "2026-10-19T00:00:00Z",
    reasons: [],
    riskScore: 0,
    usd: 0,
    simulation: "PASSED",
  };
  state.logs = [
    {
      ...base,
      id: "1",
      intent: "Fixture confirmed wrap",
      tier: "TIER_1_AUTO",
      status: "CONFIRMED",
    },
    {
      ...base,
      id: "2",
      intent: "Fixture submitted wrap",
      tier: "TIER_1_AUTO",
      status: "SUBMITTED",
    },
    {
      ...base,
      id: "3",
      intent: "Fixture blocked transfer",
      tier: "BLOCKED",
      status: "BLOCKED",
    },
  ];
  const user = userEvent.setup();
  render(<EvidenceView />);
  const table = screen.getByRole("table");
  expect(within(table).getAllByRole("row")).toHaveLength(4);
  await user.click(screen.getByRole("button", { name: "Permission tier" }));
  await user.click(screen.getByRole("option", { name: "Tier 1 (2)" }));
  await user.keyboard("{Escape}");
  expect(within(table).getAllByRole("row")).toHaveLength(3);
  await user.click(screen.getByRole("button", { name: "Status" }));
  await user.click(screen.getByRole("option", { name: "CONFIRMED (1)" }));
  await user.keyboard("{Escape}");
  expect(within(table).getAllByRole("row")).toHaveLength(2);
  expect(within(table).queryByText("Fixture submitted wrap")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Clear all" }));
  expect(within(table).getAllByRole("row")).toHaveLength(4);
});

it("keeps held and submitted Lab timeline steps pending until a real successful receipt event", () => {
  const { container, rerender } = render(
    <ExecutionSteps
      steps={[
        { stage: "policy", status: "held", message: "Awaiting operator PIN" },
        { stage: "broadcast", status: "submitted", message: "Receipt pending" },
      ]}
    />,
  );
  expect(
    container.querySelectorAll(
      '[data-slot="agent-step"][data-status="pending"]',
    ),
  ).toHaveLength(2);
  expect(container.querySelector('[data-status="success"]')).toBeNull();
  rerender(
    <ExecutionSteps
      steps={[
        {
          stage: "broadcast",
          status: "success",
          message: "Successful receipt observed on Base Sepolia.",
        },
      ]}
    />,
  );
  expect(
    container.querySelectorAll(
      '[data-slot="agent-step"][data-status="success"]',
    ),
  ).toHaveLength(1);
});
