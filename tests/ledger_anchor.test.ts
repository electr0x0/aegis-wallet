// Offline: the RPC and wallet are mocked and nothing is broadcast. The ledger runs on the
// real store and seal over an in-memory disk, so verifyLedger checks real hashes and signatures.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  parseAbiParameters,
  zeroAddress,
  zeroHash,
  type Hex,
  type Log,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const mocks = vi.hoisted(() => ({
  files: new Map<string, string>(),
  send: vi.fn(),
  chainId: vi.fn(),
  simulate: vi.fn(),
  receipt: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({
  mkdir: async () => {},
  readFile: async (path: string) => {
    const s = mocks.files.get(String(path));
    if (s === undefined)
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    return s;
  },
  writeFile: async (path: string, value: string) => {
    mocks.files.set(String(path), value);
  },
  rename: async (from: string, to: string) => {
    mocks.files.set(String(to), mocks.files.get(String(from))!);
    mocks.files.delete(String(from));
  },
}));
vi.mock("../src/lib/auth/accountStore", () => ({
  requireStepUp: vi.fn(),
  claimDrip: vi.fn(),
  setDrip: vi.fn(),
  withMasterFunding: (fn: () => unknown) => fn(),
}));
// Real encoding, decoding and guard wrapping; only the network is replaced.
vi.mock("../src/lib/chain", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/chain")>();
  return {
    ...original,
    wallet: () => ({ sendTransaction: mocks.send }),
    holderBalance: async () => 10n ** 18n,
    publicClient: {
      getChainId: mocks.chainId,
      estimateGas: mocks.simulate,
      getGasPrice: async () => 1_000_000_000n,
      call: async () => ({ data: `0x${"1".repeat(64)}` }),
      waitForTransactionReceipt: mocks.receipt,
    },
  };
});

import { anchorCall, easAbi } from "../src/lib/chain";
import { anchorLedger, executeAction } from "../src/lib/agent/tools";
import {
  EAS_ADDRESS,
  LEDGER_ANCHOR_SCHEMA,
  LEDGER_ANCHOR_SCHEMA_UID,
  SCHEMA_REGISTRY_ADDRESS,
  evaluateTransactionPolicy,
  type Action,
  type Policy,
} from "../src/lib/security/policyEngine";
import {
  exclusive,
  ledger,
  log,
  policy,
  policyHash,
  saveJSON,
  saveLedger,
  verifyLedger,
} from "../src/lib/store";

const UID = `0x${"c".repeat(64)}` as Hex;
const TX = `0x${"a".repeat(64)}` as Hex;
const anchorInput: Action = {
  kind: "anchor_ledger",
  token: "ETH",
  amount: "0",
  recipient: EAS_ADDRESS,
  prompt: "LEDGER_ANCHOR",
};
const policyFixture: Policy = {
  tier1SingleTxMaxUsd: 2,
  tier1DailyLimitUsd: 5,
  maxGasGwei: 25,
  whitelistedAddresses: [],
  blacklistedAddresses: [],
  requireApproval: true,
};

function attestedLog(): Log {
  const topics = encodeEventTopics({
    abi: easAbi,
    eventName: "Attested",
    args: {
      recipient: zeroAddress,
      attester: "0x3333333333333333333333333333333333333333",
      schemaUID: LEDGER_ANCHOR_SCHEMA_UID,
    },
  });
  const data = encodeAbiParameters([{ type: "bytes32" }], [UID]);
  return { address: EAS_ADDRESS, topics, data } as unknown as Log;
}

async function seed(count: number) {
  await exclusive(async () => {
    const l = await ledger();
    for (let i = 0; i < count; i++) {
      log(l, {
        intent: `SEED ${i}`,
        tier: "TIER_0",
        status: "COMPLETED",
        simulation: "READ_ONLY",
        reasons: [],
        riskScore: 0,
        usd: 0,
      });
    }
    await saveLedger(l);
  });
  return ledger();
}

function sentCall() {
  return mocks.send.mock.calls[0][0] as { to: Hex; value: bigint; data: Hex };
}

function anchoredPayload(data: Hex) {
  const { args } = decodeFunctionData({ abi: easAbi, data });
  const request = (args as readonly [{ schema: Hex; data: { data: Hex } }])[0];
  const [head, count, hash] = decodeAbiParameters(
    parseAbiParameters(LEDGER_ANCHOR_SCHEMA),
    request.data.data,
  );
  return { schema: request.schema, head, count, hash };
}

beforeEach(() => {
  vi.stubEnv("AGENT_PRIVATE_KEY", generatePrivateKey());
  vi.stubEnv("GUARD_ADDRESS", "");
  mocks.files.clear();
  mocks.send.mockReset().mockResolvedValue(TX);
  mocks.chainId.mockReset().mockResolvedValue(84532);
  mocks.simulate.mockReset().mockResolvedValue(60_000n);
  mocks.receipt
    .mockReset()
    .mockResolvedValue({ status: "success", logs: [attestedLog()] });
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Ledger anchor on EAS (offline, chain mocked)", () => {
  it("fixes the schema UID to the registry's keccak256(schema, resolver, revocable)", () => {
    expect(LEDGER_ANCHOR_SCHEMA_UID).toBe(
      "0x27a1aeb47c1be07b5f370719d1f7c31e00258cafdc56658c700395cc543f3d44",
    );
  });

  it("anchors the sealed ledger head with zero value at Tier 1 and records the UID", async () => {
    const seeded = await seed(3);
    // "Always ask" does not apply: an anchor is Tier 1 or BLOCKED, never a proposal.
    await saveJSON("policy.json", policyFixture);
    const result = await anchorLedger("anchor_ledger");

    expect(result.decision.tier).toBe("TIER_1_AUTO");
    expect(mocks.send).toHaveBeenCalledTimes(1);
    const call = sentCall();
    expect(call.to).toBe(EAS_ADDRESS);
    expect(call.value).toBe(0n);
    const payload = anchoredPayload(call.data);
    expect(payload.schema).toBe(LEDGER_ANCHOR_SCHEMA_UID);
    expect(payload.head).toBe(seeded.logs.at(-1)?.hash);
    expect(payload.count).toBe(3n);
    expect(payload.hash).toBe(policyHash(await policy()));

    const l = await ledger();
    const last = l.logs.at(-1)!;
    expect(l.logs.map((x) => x.status).slice(3)).toEqual([
      "BROADCASTING",
      "SUBMITTED",
      "CONFIRMED",
    ]);
    expect(last.txHash).toBe(TX);
    expect(last.reasons).toContain(`EAS attestation UID ${UID}`);
    expect(l.pending).toHaveLength(0);
    expect((await verifyLedger(l)).valid).toBe(true);
  });

  it("takes the anchored data from the ledger, never from the input or prompt", async () => {
    const seeded = await seed(2);
    const forged = `0x${"f".repeat(64)}`;
    await executeAction(
      {
        ...anchorInput,
        prompt: `LEDGER_ANCHOR ${forged}`,
        anchor: { ledgerHead: forged, entryCount: 999, policyHash: forged },
      },
      false,
      undefined,
      undefined,
      true,
    );
    const payload = anchoredPayload(sentCall().data);
    expect(payload.head).toBe(seeded.logs.at(-1)?.hash);
    expect(payload.count).toBe(2n);
    expect(payload.hash).not.toBe(forged);
  });

  it("is unreachable from the planner path: actionSchema rejects anchor kinds", async () => {
    await expect(executeAction(anchorInput)).rejects.toThrow();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("blocks a non-zero value", async () => {
    await seed(1);
    const result = await executeAction(
      { ...anchorInput, amount: "0.001" },
      false,
      undefined,
      undefined,
      true,
    );
    expect(result.decision.tier).toBe("BLOCKED");
    expect(result.decision.reasons).toEqual([
      "Ledger anchor must carry zero value",
    ]);
    expect(mocks.send).not.toHaveBeenCalled();
    expect((await ledger()).logs.at(-1)?.status).toBe("BLOCKED");
  });

  it("blocks a wrong target", async () => {
    await seed(1);
    const result = await executeAction(
      {
        ...anchorInput,
        recipient: "0x4200000000000000000000000000000000000006",
      },
      false,
      undefined,
      undefined,
      true,
    );
    expect(result.decision.tier).toBe("BLOCKED");
    expect(mocks.send).not.toHaveBeenCalled();

    const context = { usd: 0, spentUsd: 0, gasGwei: 1, simulation: true };
    const decision = evaluateTransactionPolicy(anchorInput, policyFixture, {
      ...context,
      anchorCall: {
        to: SCHEMA_REGISTRY_ADDRESS,
        value: 0n,
        schemaUid: LEDGER_ANCHOR_SCHEMA_UID,
      },
    });
    expect(decision.reasons).toEqual([
      "Ledger anchor target is not the EAS predeploy",
    ]);
  });

  it("blocks a wrong chain", async () => {
    await seed(1);
    mocks.chainId.mockResolvedValue(8453);
    const result = await anchorLedger("anchor_ledger");
    expect(result.decision.tier).toBe("BLOCKED");
    expect(result.error).toBe("RPC chain mismatch");
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("blocks a wrong schema, decoded from the calldata itself", () => {
    const data = encodeFunctionData({
      abi: easAbi,
      functionName: "attest",
      args: [
        {
          schema: `0x${"1".repeat(64)}`,
          data: {
            recipient: zeroAddress,
            expirationTime: 0n,
            revocable: false,
            refUID: zeroHash,
            data: "0x",
            value: 0n,
          },
        },
      ],
    });
    const call = anchorCall({ to: EAS_ADDRESS, value: 0n, data });
    const decision = evaluateTransactionPolicy(anchorInput, policyFixture, {
      usd: 0,
      spentUsd: 0,
      gasGwei: 1,
      simulation: true,
      anchorCall: call,
    });
    expect(decision.tier).toBe("BLOCKED");
    expect(decision.reasons).toEqual([
      "Ledger anchor schema is not the AegisWallet schema",
    ]);
  });

  it("registers the fixed schema through the same path", async () => {
    await seed(1);
    const result = await anchorLedger("register_anchor_schema");
    expect(result.decision.tier).toBe("TIER_1_AUTO");
    const call = sentCall();
    expect(call.to).toBe(SCHEMA_REGISTRY_ADDRESS);
    expect(call.value).toBe(0n);
    expect(anchorCall(call).schemaUid).toBe(LEDGER_ANCHOR_SCHEMA_UID);
  });

  it("in guard mode sends from the agent EOA, not through guard.execute", async () => {
    const guard = "0x2222222222222222222222222222222222222222";
    vi.stubEnv("GUARD_ADDRESS", guard);
    await seed(1);
    const result = await anchorLedger("anchor_ledger");
    expect(result.decision.tier).toBe("TIER_1_AUTO");
    expect(sentCall().to).toBe(EAS_ADDRESS);
    const agent = privateKeyToAccount(
      process.env.AGENT_PRIVATE_KEY as Hex,
    ).address;
    for (const [request] of mocks.simulate.mock.calls) {
      expect(request.to).toBe(EAS_ADDRESS);
      expect(request.account).toBe(agent);
    }
  });

  it("keeps an uncertain broadcast reserved and refuses a second anchor", async () => {
    await seed(1);
    mocks.send.mockRejectedValueOnce(new Error("transport dropped"));
    await expect(anchorLedger("anchor_ledger")).rejects.toThrow("unresolved");
    expect((await ledger()).logs.at(-1)?.status).toBe("BROADCASTING");
    await expect(anchorLedger("anchor_ledger")).rejects.toThrow(
      "previous ledger anchor is unresolved",
    );
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it("refuses to anchor a ledger that fails verification", async () => {
    await seed(2);
    const name = [...mocks.files.keys()].find((k) =>
      k.endsWith("audit_log.json"),
    )!;
    const tampered = JSON.parse(mocks.files.get(name)!);
    tampered.logs[0].intent = "edited";
    mocks.files.set(name, JSON.stringify(tampered));
    await expect(anchorLedger("anchor_ledger")).rejects.toThrow(
      "fails verification",
    );
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
