import { beforeEach, describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex, Transaction, TransactionReceipt } from "viem";

// SYNTHETIC FIXTURE, NOT EVIDENCE. The ledger below is sealed by the real store code with a
// throwaway key generated for each test, then read back by the independent verifier.
const mocks = vi.hoisted(() => ({
  files: new Map<string, string>(),
  key: "0x" as `0x${string}`,
}));
vi.mock("node:fs/promises", () => ({
  mkdir: async () => {},
  readFile: async (path: string) => {
    const value = mocks.files.get(String(path));
    if (value === undefined)
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    return value;
  },
  writeFile: async (path: string, value: string) => {
    mocks.files.set(String(path), value);
  },
  rename: async (from: string, to: string) => {
    mocks.files.set(String(to), mocks.files.get(String(from))!);
    mocks.files.delete(String(from));
  },
}));
vi.mock("../src/lib/chain", async () => {
  const { privateKeyToAccount } = await import("viem/accounts");
  return { ledgerSigner: () => privateKeyToAccount(mocks.key) };
});

import { ledger, log, saveLedger, type Ledger } from "../src/lib/store";
import {
  parseEvidence,
  summaryLine,
  verifyEvidence,
  type ChainReader,
} from "../scripts/verify-evidence";

// Obviously synthetic: never a hash the chain returned.
const FIXTURE_TX: Hex = `0x${"fe".repeat(32)}`;

async function sealedFixture(): Promise<Ledger> {
  const l: Ledger = { logs: [], pending: [] };
  const base = { simulation: "FIXTURE", riskScore: 0, usd: 0 };
  log(l, {
    ...base,
    intent: "FIXTURE: read the portfolio",
    tier: "TIER_0",
    status: "COMPLETED",
    reasons: ["Synthetic test entry"],
  });
  log(l, {
    ...base,
    intent: "FIXTURE: wrap 0.001 ETH",
    tier: "TIER_1_AUTO",
    status: "CONFIRMED",
    txHash: FIXTURE_TX,
    reasons: ["Synthetic test entry"],
  });
  log(l, {
    ...base,
    intent: "FIXTURE: blocked transfer",
    tier: "BLOCKED",
    status: "BLOCKED",
    reasons: ["Synthetic test entry"],
  });
  await saveLedger(l);
  // Read back what the store wrote, exactly as the CLI reads the file.
  return ledger();
}

function stubChain(status: "success" | "reverted"): ChainReader {
  const signer = privateKeyToAccount(mocks.key).address;
  return {
    getChainId: async () => 84532,
    getTransaction: async () =>
      ({
        from: signer,
        to: "0x4200000000000000000000000000000000000006",
        value: 1_000_000_000_000_000n,
        input: "0xd0e30db0",
        chainId: 84532,
      }) as unknown as Transaction,
    getTransactionReceipt: async () =>
      ({ status, contractAddress: null }) as unknown as TransactionReceipt,
  };
}

beforeEach(() => {
  mocks.files.clear();
  mocks.key = generatePrivateKey();
});

describe("independent evidence verifier", () => {
  it("accepts a ledger sealed by the store", async () => {
    const report = await verifyEvidence(parseEvidence(await sealedFixture()));
    expect(report.ok).toBe(true);
    expect(report.signer).toBe(privateKeyToAccount(mocks.key).address);
    expect(summaryLine(report)).toBe(
      "3 entries, chain intact, 3 signatures valid, receipts not checked",
    );
  });

  it("rejects the ledger after one byte of an entry is flipped", async () => {
    const text = JSON.stringify(await sealedFixture());
    const at = text.indexOf("wrap 0.001 ETH");
    const tampered = `${text.slice(0, at)}W${text.slice(at + 1)}`;
    const report = await verifyEvidence(parseEvidence(JSON.parse(tampered)));
    expect(report.ok).toBe(false);
    expect(report.rows[1].hash).toBe("BAD");
    expect(report.rows[1].problems).toContain(
      "contents do not match the recorded hash",
    );
  });

  it("rejects a signature from any key but the expected signer", async () => {
    const other = privateKeyToAccount(generatePrivateKey()).address;
    const report = await verifyEvidence(parseEvidence(await sealedFixture()), {
      signer: other,
    });
    expect(report.ok).toBe(false);
    expect(report.validSignatures).toBe(0);
  });

  it("rejects a full ledger with an entry removed", async () => {
    const fixture = await sealedFixture();
    fixture.logs.splice(1, 1);
    const report = await verifyEvidence(parseEvidence(fixture));
    expect(report.ok).toBe(false);
    expect(report.rows[1].link).toBe("BROKEN");
  });

  it("reports a dashboard export's missing entries as gaps", async () => {
    const { logs } = await sealedFixture();
    const report = await verifyEvidence(parseEvidence([logs[0], logs[2]]));
    expect(report.ok).toBe(true);
    expect(report.gaps).toBe(1);
  });

  it("requires the receipt status to agree with the ledger", async () => {
    const fixture = await sealedFixture();
    const matching = await verifyEvidence(parseEvidence(fixture), {
      client: stubChain("success"),
    });
    expect(matching.ok).toBe(true);
    expect(matching.receipts).toEqual({ checked: 1, matched: 1 });

    const reverted = await verifyEvidence(parseEvidence(fixture), {
      client: stubChain("reverted"),
    });
    expect(reverted.ok).toBe(false);
    expect(reverted.rows[1].problems).toContain(
      "ledger says CONFIRMED, receipt says reverted",
    );
  });
});
