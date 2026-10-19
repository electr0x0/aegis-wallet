// @vitest-environment jsdom
import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  WalletProvider,
  useWallet,
} from "../src/components/wallet/wallet-provider";
import type { Snapshot } from "../src/components/wallet/types";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Controls() {
  const wallet = useWallet();
  return (
    <>
      <button
        disabled={!wallet.snapshot}
        onClick={() => void wallet.decide("proposal", true)}
      >
        Authorize test proposal
      </button>
      <button
        disabled={!wallet.snapshot}
        onClick={() => void wallet.savePolicy(wallet.snapshot!.policy)}
      >
        Save test policy
      </button>
    </>
  );
}
function setup(id: string) {
  const snapshot = {
    activeAccount: { id, name: "Test account" },
    accounts: [],
    session: { status: "ACTIVE", tier1: "ACTIVE" },
    ledger: { logs: [], pending: [] },
    portfolio: null,
    error: "",
    policy: {
      tier1SingleTxMaxUsd: 2,
      tier1DailyLimitUsd: 5,
      maxGasGwei: 25,
      whitelistedAddresses: [],
      blacklistedAddresses: [],
      requireApproval: false,
    },
  } as unknown as Snapshot;
  const fetch = vi.fn(async (_url: string, options?: RequestInit) => ({
    ok: true,
    json: async () => (options?.method === "POST" ? { result: {} } : snapshot),
  }));
  vi.stubGlobal("fetch", fetch);
  render(
    <WalletProvider>
      <Controls />
    </WalletProvider>,
  );
  return fetch;
}
it("asks for the demo PIN before posting an approval, and cancellation sends nothing", async () => {
  const fetch = setup("master");
  const action = await screen.findByRole("button", {
    name: "Authorize test proposal",
  });
  await waitFor(() =>
    expect((action as HTMLButtonElement).disabled).toBe(false),
  );
  await userEvent.click(action);
  expect(
    fetch.mock.calls.filter(([, options]) => options?.method === "POST"),
  ).toHaveLength(0);
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(
    fetch.mock.calls.filter(([, options]) => options?.method === "POST"),
  ).toHaveLength(0);
  await userEvent.click(action);
  await userEvent.click(
    screen.getByRole("button", { name: "Use Demo PIN: 884210" }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Confirm PIN" }));
  await waitFor(() =>
    expect(
      fetch.mock.calls.filter(([, options]) => options?.method === "POST"),
    ).toHaveLength(1),
  );
  const body = JSON.parse(
    fetch.mock.calls.find(([, options]) => options?.method === "POST")![1]!
      .body as string,
  );
  expect(body).toMatchObject({
    type: "approval",
    accountId: "master",
    pin: "884210",
    id: "proposal",
  });
});
it("requires a custom PIN for policy saves without offering the master shortcut", async () => {
  const fetch = setup("custom-account");
  const action = await screen.findByRole("button", {
    name: "Save test policy",
  });
  await waitFor(() =>
    expect((action as HTMLButtonElement).disabled).toBe(false),
  );
  await userEvent.click(action);
  expect(
    screen.queryByRole("button", { name: "Use Demo PIN: 884210" }),
  ).toBeNull();
  await userEvent.type(screen.getByLabelText("6-Digit Operator PIN"), "123456");
  await userEvent.click(screen.getByRole("button", { name: "Confirm PIN" }));
  await waitFor(() =>
    expect(
      fetch.mock.calls.filter(([, options]) => options?.method === "POST"),
    ).toHaveLength(1),
  );
  const body = JSON.parse(
    fetch.mock.calls.find(([, options]) => options?.method === "POST")![1]!
      .body as string,
  );
  expect(body).toMatchObject({
    type: "policy",
    accountId: "custom-account",
    pin: "123456",
  });
});
