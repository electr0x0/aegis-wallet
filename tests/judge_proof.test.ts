import { beforeEach, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  encodeAbiParameters,
  encodeFunctionData,
  parseAbi,
  parseAbiParameters,
  zeroHash,
  zeroAddress,
  type Hex,
} from "viem";
const mocks = vi.hoisted(() => ({ chain: vi.fn(), read: vi.fn() }));
vi.mock("../src/lib/chain", () => ({
  publicClient: { getChainId: mocks.chain, readContract: mocks.read },
}));
import {
  entryHash,
  verifyEvidence,
  type Evidence,
  type EvidenceEntry,
} from "../src/lib/evidence/verify";
import { parseUpload, verifyUpload } from "../src/lib/evidence/upload";
import {
  verifyCheckpoint,
  type Attestation,
} from "../src/lib/evidence/checkpoint";
import {
  LEDGER_ANCHOR_SCHEMA,
  LEDGER_ANCHOR_SCHEMA_UID,
} from "../src/lib/security/policyEngine";
import { judgeReadiness } from "../src/lib/judge/readiness";
import type { Snapshot } from "../src/components/wallet/types";

// SYNTHETIC signed fixtures only. No transactions, evidence claims or persistent writes.
const uid: Hex = `0x${"cd".repeat(32)}`;
async function fixture() {
  const account = privateKeyToAccount(generatePrivateKey());
  const entries: EvidenceEntry[] = [];
  for (let index = 0; index < 2; index++) {
    const entry: EvidenceEntry = {
      id: `FIXTURE-${index}`,
      timestamp: "2026-01-01T00:00:00.000Z",
      intent: "SYNTHETIC READ, NOT EVIDENCE",
      tier: "TIER_0",
      status: "COMPLETED",
      reasons: ["TEST_ONLY"],
      prevHash: entries.at(-1)?.hash ?? zeroHash,
    };
    entry.hash = entryHash(entry);
    entry.signer = account.address;
    entry.signature = await account.signMessage({
      message: { raw: entry.hash },
    });
    entries.push(entry);
  }
  const evidence: Evidence = { entries, complete: true };
  const report = await verifyEvidence(evidence, { signer: account.address });
  const record: Attestation = {
    uid,
    schema: LEDGER_ANCHOR_SCHEMA_UID,
    time: 1n,
    expirationTime: 0n,
    revocationTime: 0n,
    refUID: zeroHash,
    recipient: zeroAddress,
    attester: account.address,
    revocable: false,
    data: encodeAbiParameters(parseAbiParameters(LEDGER_ANCHOR_SCHEMA), [
      entries[1].hash!,
      2n,
      zeroHash,
    ]),
  };
  return { account, evidence, report, record };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.chain.mockResolvedValue(84532);
});
it("verifies signed uploads offline without RPC, strips prompts from its report, and requires a trusted signer", async () => {
  const f = await fixture();
  const input = {
    text: JSON.stringify({ logs: f.evidence.entries }),
    signer: f.account.address,
    online: false,
  };
  const report = await verifyUpload(input);
  expect(report.ok).toBe(true);
  expect(report.signatures).toBe(2);
  expect(report.complete).toBe(true);
  expect(report.receipts).toBeNull();
  expect(mocks.chain).not.toHaveBeenCalled();
  expect(mocks.read).not.toHaveBeenCalled();
  expect(JSON.stringify(report)).not.toContain("SYNTHETIC READ");
  expect((await verifyUpload({ ...input, signer: zeroAddress })).ok).toBe(
    false,
  );
  const changed = structuredClone(f.evidence.entries);
  changed[1].intent = "ALTERED FIXTURE";
  expect(
    (await verifyUpload({ ...input, text: JSON.stringify(changed) })).ok,
  ).toBe(false);
});
it("checks a guard-routed recipient when an older export omits its deployment entry", async () => {
  const f = await fixture();
  const guard: Hex = `0x${"ab".repeat(20)}`;
  const recipient: Hex = `0x${"ef".repeat(20)}`;
  const entry: EvidenceEntry = {
    id: "SYNTHETIC-GUARD",
    intent: `FIXTURE transfer 1 USDC to ${recipient}`,
    status: "CONFIRMED",
    tier: "TIER_2_HITL",
    prevHash: zeroHash,
    txHash: uid,
    reasons: ["Executed with owner-signed approval via AgentGuard"],
  };
  entry.hash = entryHash(entry);
  entry.signer = f.account.address;
  entry.signature = await f.account.signMessage({
    message: { raw: entry.hash },
  });
  const transfer = encodeFunctionData({
    abi: parseAbi([
      "function transfer(address to, uint256 amount) returns (bool)",
    ]),
    functionName: "transfer",
    args: [recipient, 1000000n],
  });
  const input = encodeFunctionData({
    abi: parseAbi([
      "function execute(address target, uint256 value, bytes data)",
    ]),
    functionName: "execute",
    args: [zeroAddress, 0n, transfer],
  });
  const client = {
    getChainId: async () => 84532,
    getTransaction: async () => ({
      from: f.account.address,
      to: guard,
      input,
      value: 0n,
      chainId: 84532,
    }),
    getTransactionReceipt: async () => ({ status: "success" as const }),
  };
  const evidence = { entries: [entry], complete: false };
  expect(
    (await verifyEvidence(evidence, { signer: f.account.address, client })).ok,
  ).toBe(false);
  const verified = await verifyEvidence(evidence, {
    signer: f.account.address,
    client,
    guard,
  });
  expect(verified.ok).toBe(true);
  expect(verified.rows[0].onchain).toContain("pays");
  const wrong = await verifyEvidence(evidence, {
    signer: f.account.address,
    client,
    guard: zeroAddress,
  });
  expect(wrong.ok).toBe(false);
});
it("detects a truncated anchored prefix while identifying newer unanchored entries", async () => {
  const f = await fixture();
  const intact = verifyCheckpoint(
    f.evidence,
    f.report,
    f.record,
    uid,
    f.account.address,
  );
  expect(intact.ok).toBe(true);
  expect(intact.unanchoredEntries).toBe(0);
  const shorter = { entries: f.evidence.entries.slice(0, 1), complete: true };
  const shortReport = await verifyEvidence(shorter, {
    signer: f.account.address,
  });
  expect(shortReport.ok).toBe(true); // Seals alone cannot detect tail deletion.
  expect(
    verifyCheckpoint(
      shorter,
      shortReport,
      f.record,
      uid,
      f.account.address,
    ).problems.join(),
  ).toContain("shorter");
  const firstAnchor = {
    ...f.record,
    data: encodeAbiParameters(parseAbiParameters(LEDGER_ANCHOR_SCHEMA), [
      f.evidence.entries[0].hash!,
      1n,
      zeroHash,
    ]),
  };
  expect(
    verifyCheckpoint(f.evidence, f.report, firstAnchor, uid, f.account.address)
      .unanchoredEntries,
  ).toBe(1);
  expect(
    verifyCheckpoint(f.evidence, f.report, firstAnchor, uid, f.account.address)
      .ok,
  ).toBe(true);
});
it.each([
  "schema",
  "attester",
  "revocationTime",
  "expirationTime",
  "uid",
  "revocable",
  "data",
] as const)(
  "rejects an untrusted or inconsistent checkpoint field: %s",
  async (field) => {
    const f = await fixture();
    const changed = { ...f.record };
    const values = {
      schema: zeroHash,
      attester: zeroAddress,
      revocationTime: 1n,
      expirationTime: 1n,
      uid: zeroHash,
      revocable: true,
      data: encodeAbiParameters(parseAbiParameters(LEDGER_ANCHOR_SCHEMA), [
        zeroHash,
        2n,
        zeroHash,
      ]),
    };
    Object.assign(changed, { [field]: values[field] });
    expect(
      verifyCheckpoint(f.evidence, f.report, changed, uid, f.account.address)
        .ok,
    ).toBe(false);
  },
);
it("never claims full checkpoint coverage for an account array, empty ledger or bad seals", async () => {
  const f = await fixture();
  const partial = { entries: f.evidence.entries.slice(1), complete: false };
  const report = await verifyEvidence(partial, { signer: f.account.address });
  expect(report.ok).toBe(true);
  expect(report.gaps).toBe(1);
  const checkpoint = verifyCheckpoint(
    partial,
    report,
    f.record,
    uid,
    f.account.address,
  );
  expect(checkpoint.ok).toBe(false);
  expect(checkpoint.headFound).toBe(true);
  expect(checkpoint.unanchoredEntries).toBeNull();
  expect(
    (
      await verifyEvidence(
        { entries: [], complete: true },
        { signer: f.account.address },
      )
    ).ok,
  ).toBe(false);
  expect(
    verifyCheckpoint(
      f.evidence,
      { ...f.report, ok: false },
      f.record,
      uid,
      f.account.address,
    ).ok,
  ).toBe(false);
});
it("bounds imported documents and rejects wrong-chain or offline checkpoint requests", async () => {
  expect(() => parseUpload(" ".repeat(2_000_001), false)).toThrow("2 MB");
  expect(() => parseUpload('{"accounts":[]}', false)).toThrow();
  const f = await fixture();
  expect(() =>
    parseUpload(JSON.stringify(Array(1001).fill(f.evidence.entries[0])), false),
  ).toThrow();
  expect(() =>
    parseUpload(
      JSON.stringify([{ ...f.evidence.entries[0], reasons: "not an array" }]),
      false,
    ),
  ).toThrow();
  const input = {
    text: JSON.stringify({ logs: f.evidence.entries }),
    signer: f.account.address,
    online: false,
    checkpointUid: uid,
  };
  await expect(verifyUpload(input)).rejects.toThrow("online mode");
  mocks.chain.mockResolvedValue(1);
  await expect(verifyUpload({ ...input, online: true })).rejects.toThrow(
    "84532",
  );
  expect(mocks.read).not.toHaveBeenCalled();
});
it("distinguishes an unavailable checkpoint from a successful seal check", async () => {
  const f = await fixture();
  mocks.read.mockRejectedValue(new Error("TEST_ONLY unavailable"));
  const report = await verifyUpload({
    text: JSON.stringify({ logs: f.evidence.entries }),
    signer: f.account.address,
    online: true,
    checkpointUid: uid,
  });
  expect(report.ok).toBe(true);
  expect(report.checkpoint).toBeNull();
  expect(report.checkpointError).toContain("unverified");
});
it("reports missing readiness honestly and deduplicates resolved broadcasts", () => {
  expect(judgeReadiness(null)[0].status).toBe("unavailable");
  const snapshot = {
    policy: {
      tier1SingleTxMaxUsd: 2,
      tier1DailyLimitUsd: 5,
      maxGasGwei: 25,
      whitelistedAddresses: [],
      blacklistedAddresses: [],
      requireApproval: true,
    },
    planner: [],
    guard: null,
    portfolio: null,
    ledger: {
      logs: [
        { id: "1", operationId: "same", status: "SUBMITTED" },
        { id: "2", operationId: "same", status: "CONFIRMED" },
      ],
      pending: [],
    },
    error: "TEST_ONLY unavailable",
  } as unknown as Snapshot;
  const rows = judgeReadiness(snapshot);
  expect(rows.find((r) => r.id === "planner")?.status).toBe("attention");
  expect(rows.find((r) => r.id === "tiers")?.detail).toContain("Always ask");
  expect(rows.find((r) => r.id === "gas")?.status).toBe("unavailable");
  expect(rows.find((r) => r.id === "outcomes")?.status).toBe("ready");
  expect(rows.find((r) => r.id === "scenarios")?.status).toBe("attention");
});
