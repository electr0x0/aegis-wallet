// AgentGuard contract suite. OFFLINE: in-process EVM, not Base Sepolia.
//
// Every test runs the committed artifact src/lib/guard/AgentGuard.json on a fresh
// @ethereumjs/evm instance. There is no RPC, no broadcast and no real key, so nothing here is
// on-chain evidence (rule 6). The EVM reports chain ID 84532, so owner approvals are signed and
// verified exactly as in production. The mock token, WETH and probe recipient below are compiled
// with the same pinned solc 0.8.37 and settings as scripts/compile-guard.mjs.
import {
  createEVM,
  Message,
  type EVM,
  type EVMRunCallOpts,
} from "@ethereumjs/evm";
import solc from "solc";
import {
  RawContractError,
  bytesToHex,
  concat,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeDeployData,
  encodeFunctionData,
  getAddress,
  hashMessage,
  hexToBigInt,
  hexToBytes,
  hexToNumber,
  keccak256,
  numberToHex,
  parseAbi,
  parseAbiParameters,
  parseEther,
  parseUnits,
  slice,
  toHex,
  zeroAddress,
  type Abi,
  type Hex,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { afterEach, describe, expect, it, vi } from "vitest";
import artifact from "../src/lib/guard/AgentGuard.json";
import {
  abi as tokenAbi,
  decodeGuardError,
  guardAbi,
  outerCall,
  publicClient,
  signOwnerApproval,
  type Call,
} from "../src/lib/chain";

// The EVM is interpreted JavaScript; leave headroom on a loaded machine.
vi.setConfig({ testTimeout: 30_000 });

// ---------------------------------------------------------------- constants

const CHAIN_ID = 84532n;
const DAY = 86_400n;
const START = 1_790_000_000n; // a fixed mid-day UTC timestamp
const SESSION_EXPIRY = START + 30n * DAY;
const APPROVAL_TTL = 600n;
const NATIVE = zeroAddress;
const SECP256K1_N =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const ECRECOVER = "0x0000000000000000000000000000000000000001";

// Deterministic throwaway keys. They exist only inside this in-process EVM.
const testKey = (label: string) => keccak256(toHex(label));
const OWNER_KEY = testKey("aegis test owner");
const OWNER = privateKeyToAccount(OWNER_KEY);
const SESSION = privateKeyToAccount(testKey("aegis test session key"));
const STRANGER = privateKeyToAccount(testKey("aegis test stranger"));
const ALICE = privateKeyToAccount(testKey("aegis test recipient")).address;

// Same caps as scripts/deploy-guard.ts.
const ETH_LIMIT = { perTx: parseEther("0.01"), perDay: parseEther("0.02") };
const TOKEN_LIMIT = { perTx: parseUnits("20", 6), perDay: parseUnits("50", 6) };
const GUARD_ETH = parseEther("1");
const GUARD_TOKENS = parseUnits("10000", 6);

const drainAbi = parseAbi([
  "function approve(address,uint256) returns (bool)",
  "function transferFrom(address,address,uint256) returns (bool)",
  "function permit(address,address,uint256,uint256,uint8,bytes32,bytes32)",
]);

// ---------------------------------------------------------------- test-only contracts

const MOCKS_SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

contract MockToken {
    mapping(address => uint256) public balanceOf;
    bool public failTransfers;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function setFailTransfers(bool fail) external {
        failTransfers = fail;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (failTransfers) return false;
        require(balanceOf[msg.sender] >= amount, "insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract MockWeth {
    mapping(address => uint256) public balanceOf;

    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
    }

    function withdraw(uint256 amount) external {
        balanceOf[msg.sender] -= amount;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "eth send failed");
    }
}

interface IAgentGuard {
    function remaining(address asset) external view returns (uint256);
    function execute(address target, uint256 value, bytes calldata data) external returns (bytes memory);
}

/// Allowlisted recipient. Records the guard's remaining ETH allowance while being paid, and can
/// try to re-enter execute.
contract ProbeRecipient {
    uint256 public remainingWhenPaid;
    bool public reenter;

    function setReenter(bool value) external {
        reenter = value;
    }

    receive() external payable {
        IAgentGuard guard = IAgentGuard(msg.sender);
        remainingWhenPaid = guard.remaining(address(0));
        if (reenter) guard.execute(address(this), msg.value, "");
    }
}
`;

type Compiled = { abi: Abi; bytecode: Hex };

/** Same compiler settings as scripts/compile-guard.mjs. */
function compile(path: string, content: string): Record<string, Compiled> {
  const input = {
    language: "Solidity",
    sources: { [path]: { content } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors ?? []).filter(
    (diagnostic: { severity: string }) => diagnostic.severity === "error",
  );
  if (errors.length > 0) throw new Error(JSON.stringify(errors));
  const contracts = output.contracts[path] as Record<
    string,
    { abi: Abi; evm: { bytecode: { object: string } } }
  >;
  return Object.fromEntries(
    Object.entries(contracts).map(([name, contract]) => [
      name,
      { abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}` },
    ]),
  );
}

const MOCKS = compile("Mocks.sol", MOCKS_SOURCE);

// ---------------------------------------------------------------- in-process chain

type EvmAddress = NonNullable<EVMRunCallOpts["caller"]>;
// @ethereumjs/evm does not re-export the Address class from @ethereumjs/util, but every Message
// carries an instance of it.
const EvmAddressClass = new Message({ gasLimit: 0n }).caller
  .constructor as new (bytes: Uint8Array) => EvmAddress;
const evmAddress = (address: Hex) => new EvmAddressClass(hexToBytes(address));

type Outcome = { ok: boolean; output: Hex; created?: Hex };

/** One fresh EVM per test. `now` is the block timestamp of the next call. */
class TestChain {
  now = START;

  private constructor(private readonly evm: EVM) {}

  static async create(): Promise<TestChain> {
    const evm = await createEVM();
    // CHAINID reads common.chainId(). Report Base Sepolia, like production.
    evm.common.chainId = () => CHAIN_ID;
    return new TestChain(evm);
  }

  async send(
    from: Hex,
    to: Hex | undefined,
    data: Hex,
    value = 0n,
  ): Promise<Outcome> {
    const result = await this.evm.runCall({
      caller: evmAddress(from),
      to: to ? evmAddress(to) : undefined,
      data: hexToBytes(data),
      value,
      skipBalance: true,
      block: this.block(),
    });
    const created = result.createdAddress?.toString() as Hex | undefined;
    return {
      ok: result.execResult.exceptionError === undefined,
      output: bytesToHex(result.execResult.returnValue),
      created: created && getAddress(created),
    };
  }

  async deploy(initCode: Hex, value = 0n): Promise<Hex> {
    const outcome = await this.send(OWNER.address, undefined, initCode, value);
    if (!outcome.ok || !outcome.created) throw new Error("deploy reverted");
    return outcome.created;
  }

  call(
    from: Hex,
    to: Hex,
    abi: Abi,
    functionName: string,
    args: readonly unknown[] = [],
    value = 0n,
  ): Promise<Outcome> {
    const data = encodeFunctionData({ abi, functionName, args });
    return this.send(from, to, data, value);
  }

  async read<T>(
    to: Hex,
    abi: Abi,
    functionName: string,
    args: readonly unknown[] = [],
  ): Promise<T> {
    const outcome = await this.call(
      STRANGER.address,
      to,
      abi,
      functionName,
      args,
    );
    if (!outcome.ok) throw new Error(`${functionName} reverted`);
    return decodeFunctionResult({
      abi,
      functionName,
      data: outcome.output,
    }) as T;
  }

  async balance(address: Hex): Promise<bigint> {
    const account = await this.evm.stateManager.getAccount(evmAddress(address));
    return account?.balance ?? 0n;
  }

  private block() {
    return {
      header: {
        number: 1n,
        coinbase: evmAddress(zeroAddress),
        timestamp: this.now,
        difficulty: 0n,
        prevRandao: new Uint8Array(32),
        gasLimit: 30_000_000n,
        getBlobGasPrice: () => undefined,
      },
    };
  }
}

// ---------------------------------------------------------------- guard fixture

type GuardConfig = {
  owner: Hex;
  sessionKey: Hex;
  expiry: bigint;
  targets: Hex[];
  recipients: Hex[];
  assets: Hex[];
  perTx: bigint[];
  perDay: bigint[];
};

function guardInitCode(config: GuardConfig): Hex {
  return encodeDeployData({
    abi: guardAbi,
    bytecode: artifact.bytecode as Hex,
    args: [
      config.owner,
      config.sessionKey,
      config.expiry,
      config.targets,
      config.recipients,
      config.assets,
      config.perTx,
      config.perDay,
    ],
  });
}

type Fixture = {
  chain: TestChain;
  config: GuardConfig;
  guard: Hex;
  token: Hex;
  weth: Hex;
  probe: Hex;
};

/** A guard configured like production: ETH, WETH and a 6-decimal token, two recipients. */
async function setup(): Promise<Fixture> {
  const chain = await TestChain.create();
  const token = await chain.deploy(MOCKS.MockToken.bytecode);
  const weth = await chain.deploy(MOCKS.MockWeth.bytecode);
  const probe = await chain.deploy(MOCKS.ProbeRecipient.bytecode);
  const config: GuardConfig = {
    owner: OWNER.address,
    sessionKey: SESSION.address,
    expiry: SESSION_EXPIRY,
    targets: [token, weth],
    recipients: [ALICE, probe],
    assets: [NATIVE, weth, token],
    perTx: [ETH_LIMIT.perTx, ETH_LIMIT.perTx, TOKEN_LIMIT.perTx],
    perDay: [ETH_LIMIT.perDay, ETH_LIMIT.perDay, TOKEN_LIMIT.perDay],
  };
  const guard = await chain.deploy(guardInitCode(config), GUARD_ETH);
  const mintArgs = [guard, GUARD_TOKENS];
  await chain.call(OWNER.address, token, MOCKS.MockToken.abi, "mint", mintArgs);
  return { chain, config, guard, token, weth, probe };
}

const guardData = (functionName: string, args: readonly unknown[] = []) =>
  encodeFunctionData({ abi: guardAbi, functionName, args });

const sendEth = (to: Hex, value: bigint): Call => ({ to, value, data: "0x" });

function sendToken(token: Hex, to: Hex, amount: bigint, value = 0n): Call {
  const data = encodeFunctionData({
    abi: tokenAbi,
    functionName: "transfer",
    args: [to, amount],
  });
  return { to: token, value, data };
}

function execute(t: Fixture, inner: Call, from: Hex = SESSION.address) {
  const args = [inner.to, inner.value, inner.data ?? "0x"];
  return t.chain.call(from, t.guard, guardAbi, "execute", args);
}

function admin(
  t: Fixture,
  functionName: string,
  args: readonly unknown[] = [],
  from: Hex = OWNER.address,
) {
  return t.chain.call(from, t.guard, guardAbi, functionName, args);
}

const readGuard = <T>(t: Fixture, functionName: string, args: unknown[] = []) =>
  t.chain.read<T>(t.guard, guardAbi, functionName, args);

const remaining = (t: Fixture, asset: Hex) =>
  readGuard<bigint>(t, "remaining", [asset]);

const tokenBalance = (t: Fixture, holder: Hex) =>
  t.chain.read<bigint>(t.token, tokenAbi, "balanceOf", [holder]);

const nextUtcDay = (timestamp: bigint) => (timestamp / DAY + 1n) * DAY;

// ---------------------------------------------------------------- owner approvals

type Approval = {
  target: Hex;
  value: bigint;
  data: Hex;
  nonce: bigint;
  deadline: bigint;
};

function approvalFor(t: Fixture, inner: Call, nonce = 1n): Approval {
  return {
    target: inner.to,
    value: inner.value,
    data: inner.data ?? "0x",
    nonce,
    deadline: t.chain.now + APPROVAL_TTL,
  };
}

/** The AgentGuard.approvalDigest layout, with every bound field explicit. */
function digestOf(guard: Hex, a: Approval, chainId = CHAIN_ID): Hex {
  const types = parseAbiParameters(
    "uint256, address, address, uint256, bytes32, uint256, uint256",
  );
  const values = [
    chainId,
    guard,
    a.target,
    a.value,
    keccak256(a.data),
    a.nonce,
    a.deadline,
  ] as const;
  return keccak256(encodeAbiParameters(types, values));
}

function sign(
  guard: Hex,
  a: Approval,
  signer: PrivateKeyAccount = OWNER,
  chainId = CHAIN_ID,
): Promise<Hex> {
  return signer.signMessage({ message: { raw: digestOf(guard, a, chainId) } });
}

function executeApproved(
  t: Fixture,
  a: Approval,
  signature: Hex,
  from: Hex = SESSION.address,
  guard: Hex = t.guard,
) {
  const args = [a.target, a.value, a.data, a.nonce, a.deadline, signature];
  return t.chain.call(from, guard, guardAbi, "executeApproved", args);
}

function splitSignature(signature: Hex) {
  return {
    r: slice(signature, 0, 32),
    s: hexToBigInt(slice(signature, 32, 64)),
    v: hexToNumber(slice(signature, 64, 65)),
  };
}

function joinSignature(r: Hex, s: bigint, v: number): Hex {
  return concat([r, numberToHex(s, { size: 32 }), numberToHex(v, { size: 1 })]);
}

/** Calls the ecrecover precompile directly: what the guard would accept without its own checks. */
async function rawEcrecover(t: Fixture, hash: Hex, signature: Hex) {
  const { r, s, v } = splitSignature(signature);
  const input = concat([
    hash,
    numberToHex(v, { size: 32 }),
    r,
    numberToHex(s, { size: 32 }),
  ]);
  const outcome = await t.chain.send(STRANGER.address, ECRECOVER, input);
  return outcome.output === "0x"
    ? zeroAddress
    : getAddress(slice(outcome.output, 12));
}

// ---------------------------------------------------------------- assertions

/** Asserts a revert and decodes it through the dashboard's own decodeGuardError. */
function expectRejected(outcome: Outcome, error: string) {
  expect(outcome.ok).toBe(false);
  const decoded = decodeGuardError(
    new RawContractError({ data: outcome.output }),
  );
  expect(decoded).toBe(`On-chain guard rejected: ${error}`);
}

function expectInnerRevert(outcome: Outcome, reason: string) {
  expect(outcome.ok).toBe(false);
  const decoded = decodeGuardError(
    new RawContractError({ data: outcome.output }),
  );
  expect(decoded).toBe(`On-chain guard: inner call reverted (${reason})`);
}

function expectOk(outcome: Outcome) {
  expect(outcome.ok, outcome.output).toBe(true);
}

// ---------------------------------------------------------------- seeded randomness

/** mulberry32: a tiny seeded PRNG, so a failing run replays exactly. */
function prng(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let x = Math.imul(state ^ (state >>> 15), 1 | state);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function randomHex(random: () => number, size: number): Hex {
  const bytes = Uint8Array.from({ length: size }, () =>
    Math.floor(random() * 256),
  );
  return bytesToHex(bytes);
}

const randomBelow = (random: () => number, limit: bigint) =>
  BigInt(Math.floor(random() * Number(limit)));

// ================================================================ tests

describe("constructor", () => {
  it("stores the owner, session, allowlists and limits, and accepts ETH", async () => {
    const t = await setup();
    expect(await readGuard(t, "owner")).toBe(OWNER.address);
    expect(await readGuard(t, "sessionKey")).toBe(SESSION.address);
    expect(await readGuard(t, "sessionExpiry")).toBe(SESSION_EXPIRY);
    expect(await readGuard(t, "allowedTarget", [t.token])).toBe(true);
    expect(await readGuard(t, "allowedTarget", [t.guard])).toBe(false);
    expect(await readGuard(t, "allowedRecipient", [ALICE])).toBe(true);
    expect(await readGuard(t, "allowedRecipient", [STRANGER.address])).toBe(
      false,
    );
    const [perTx, perDay, spent] = await readGuard<bigint[]>(t, "limits", [
      t.token,
    ]);
    expect([perTx, perDay, spent]).toEqual([
      TOKEN_LIMIT.perTx,
      TOKEN_LIMIT.perDay,
      0n,
    ]);
    expect(await t.chain.balance(t.guard)).toBe(GUARD_ETH);
  });

  it("rejects a zero owner", async () => {
    const t = await setup();
    const initCode = guardInitCode({ ...t.config, owner: zeroAddress });
    expectRejected(
      await t.chain.send(OWNER.address, undefined, initCode),
      "NotOwner",
    );
  });

  it("rejects limit arrays of different lengths", async () => {
    const t = await setup();
    const shortPerTx = guardInitCode({ ...t.config, perTx: [1n] });
    const shortPerDay = guardInitCode({ ...t.config, perDay: [1n] });
    for (const initCode of [shortPerTx, shortPerDay]) {
      const outcome = await t.chain.send(OWNER.address, undefined, initCode);
      expectRejected(outcome, "LengthMismatch");
    }
  });
});

describe("execute: caller and session", () => {
  it("only the session key can call it, not the owner or a stranger", async () => {
    const t = await setup();
    const inner = sendEth(ALICE, 1n);
    expectRejected(await execute(t, inner, OWNER.address), "NotSessionKey");
    expectRejected(await execute(t, inner, STRANGER.address), "NotSessionKey");
    expectOk(await execute(t, inner));
  });

  it("works up to the expiry second and fails after it", async () => {
    const t = await setup();
    t.chain.now = SESSION_EXPIRY;
    expectOk(await execute(t, sendEth(ALICE, 1n)));
    t.chain.now = SESSION_EXPIRY + 1n;
    expectRejected(await execute(t, sendEth(ALICE, 1n)), "SessionExpired");
  });
});

describe("execute: allowlists and call shapes", () => {
  it("rejects a target that is not allowlisted", async () => {
    const t = await setup();
    const otherToken = await t.chain.deploy(MOCKS.MockToken.bytecode);
    const inner = sendToken(otherToken, ALICE, 1n);
    expectRejected(await execute(t, inner), "TargetNotAllowed");
  });

  it("rejects transfer on an allowlisted target that has no limit", async () => {
    const t = await setup();
    const otherToken = await t.chain.deploy(MOCKS.MockToken.bytecode);
    expectOk(await admin(t, "setTarget", [otherToken, true]));
    const inner = sendToken(otherToken, ALICE, 1n);
    expectRejected(await execute(t, inner), "TargetNotAllowed");
  });

  it("rejects recipients that are not allowlisted, for ETH and for tokens", async () => {
    const t = await setup();
    const toStranger = sendToken(t.token, STRANGER.address, 1n);
    expectRejected(await execute(t, toStranger), "RecipientNotAllowed");
    const ethToStranger = sendEth(STRANGER.address, 1n);
    expectRejected(await execute(t, ethToStranger), "RecipientNotAllowed");
    // An allowlisted target is not an allowlisted ETH recipient.
    expectRejected(
      await execute(t, sendEth(t.token, 1n)),
      "RecipientNotAllowed",
    );
    expectOk(await execute(t, sendToken(t.token, ALICE, 1n)));
  });

  it("rejects approve, transferFrom, permit and any other selector", async () => {
    const t = await setup();
    const drains: Hex[] = [
      encodeFunctionData({
        abi: drainAbi,
        functionName: "approve",
        args: [STRANGER.address, 2n ** 256n - 1n],
      }),
      encodeFunctionData({
        abi: drainAbi,
        functionName: "transferFrom",
        args: [t.guard, STRANGER.address, 1n],
      }),
      encodeFunctionData({
        abi: drainAbi,
        functionName: "permit",
        args: [
          t.guard,
          STRANGER.address,
          1n,
          1n,
          27,
          toHex(1, { size: 32 }),
          toHex(2, { size: 32 }),
        ],
      }),
      encodeFunctionData({
        abi: MOCKS.MockToken.abi,
        functionName: "mint",
        args: [STRANGER.address, 1n],
      }),
    ];
    for (const data of drains) {
      const outcome = await execute(t, { to: t.token, value: 0n, data });
      expectRejected(outcome, "SelectorNotAllowed");
    }
  });

  it("rejects calldata shorter than a selector", async () => {
    const t = await setup();
    for (const data of ["0xa9", "0xa905", "0xa9059c"] as Hex[]) {
      const outcome = await execute(t, { to: t.token, value: 0n, data });
      expectRejected(outcome, "SelectorNotAllowed");
    }
  });

  it("rejects ETH value on token transfer and on withdraw", async () => {
    const t = await setup();
    const transferWithValue = sendToken(t.token, ALICE, 1n, 1n);
    expectRejected(await execute(t, transferWithValue), "ValueNotAllowed");
    const withdrawWithValue = {
      to: t.weth,
      value: 1n,
      data: encodeFunctionData({
        abi: tokenAbi,
        functionName: "withdraw",
        args: [1n],
      }),
    };
    expectRejected(await execute(t, withdrawWithValue), "ValueNotAllowed");
  });

  it("books deposit against the ETH limit and leaves withdraw unmetered", async () => {
    const t = await setup();
    const amount = ETH_LIMIT.perTx;
    const deposit = {
      to: t.weth,
      value: amount,
      data: encodeFunctionData({ abi: tokenAbi, functionName: "deposit" }),
    };
    expectRejected(
      await execute(t, { ...deposit, value: amount + 1n }),
      "PerTxLimitExceeded",
    );
    expectOk(await execute(t, deposit));
    expect(await remaining(t, NATIVE)).toBe(ETH_LIMIT.perDay - amount);

    const withdraw = {
      to: t.weth,
      value: 0n,
      data: encodeFunctionData({
        abi: tokenAbi,
        functionName: "withdraw",
        args: [amount],
      }),
    };
    expectOk(await execute(t, withdraw));
    expect(await t.chain.balance(t.guard)).toBe(GUARD_ETH);
    expect(await remaining(t, NATIVE)).toBe(ETH_LIMIT.perDay - amount);
  });

  it("reverts TokenTransferFailed when a token returns false", async () => {
    const t = await setup();
    const fail = [true];
    await t.chain.call(
      OWNER.address,
      t.token,
      MOCKS.MockToken.abi,
      "setFailTransfers",
      fail,
    );
    const outcome = await execute(t, sendToken(t.token, ALICE, 1n));
    expectRejected(outcome, "TokenTransferFailed");
  });

  it("cannot reach the guard's admin functions", async () => {
    const t = await setup();
    const raiseLimit = {
      to: t.guard,
      value: 0n,
      data: guardData("setLimit", [NATIVE, GUARD_ETH, GUARD_ETH]),
    };
    expectRejected(await execute(t, raiseLimit), "TargetNotAllowed");
    // Even if the owner allowlisted the guard itself, admin selectors stay blocked.
    expectOk(await admin(t, "setTarget", [t.guard, true]));
    expectRejected(await execute(t, raiseLimit), "SelectorNotAllowed");
  });
});

describe("execute: spending limits", () => {
  it("enforces the per-transaction cap for ETH and tokens", async () => {
    const t = await setup();
    const ethOverCap = sendEth(ALICE, ETH_LIMIT.perTx + 1n);
    expectRejected(await execute(t, ethOverCap), "PerTxLimitExceeded");
    const tokenOverCap = sendToken(t.token, ALICE, TOKEN_LIMIT.perTx + 1n);
    expectRejected(await execute(t, tokenOverCap), "PerTxLimitExceeded");
    expectOk(await execute(t, sendEth(ALICE, ETH_LIMIT.perTx)));
    expectOk(await execute(t, sendToken(t.token, ALICE, TOKEN_LIMIT.perTx)));
    expect(await tokenBalance(t, ALICE)).toBe(TOKEN_LIMIT.perTx);
  });

  it("enforces the per-UTC-day cap and resets it at midnight UTC", async () => {
    const t = await setup();
    const { perTx, perDay } = ETH_LIMIT;
    expectOk(await execute(t, sendEth(ALICE, perTx)));
    expectOk(await execute(t, sendEth(ALICE, perDay - perTx)));
    expect(await remaining(t, NATIVE)).toBe(0n);
    expectRejected(await execute(t, sendEth(ALICE, 1n)), "DailyLimitExceeded");

    const midnight = nextUtcDay(t.chain.now);
    t.chain.now = midnight - 1n;
    expectRejected(await execute(t, sendEth(ALICE, 1n)), "DailyLimitExceeded");

    // The bucket resets lazily: the view already shows a full day, before any spend.
    t.chain.now = midnight;
    expect(await remaining(t, NATIVE)).toBe(perDay);
    expectOk(await execute(t, sendEth(ALICE, perTx)));
    expectOk(await execute(t, sendEth(ALICE, perDay - perTx)));
    expectRejected(await execute(t, sendEth(ALICE, 1n)), "DailyLimitExceeded");
    // Known residual (R3): two full daily caps either side of midnight UTC.
    expect(await t.chain.balance(ALICE)).toBe(2n * perDay);
  });

  it("books the spend before the external call", async () => {
    const t = await setup();
    const amount = ETH_LIMIT.perTx;
    expectOk(await execute(t, sendEth(t.probe, amount)));
    const abi = MOCKS.ProbeRecipient.abi;
    const seen = await t.chain.read<bigint>(t.probe, abi, "remainingWhenPaid");
    expect(seen).toBe(ETH_LIMIT.perDay - amount);
  });

  it("fails when a recipient re-enters execute, and books nothing", async () => {
    const t = await setup();
    const abi = MOCKS.ProbeRecipient.abi;
    expectOk(
      await t.chain.call(OWNER.address, t.probe, abi, "setReenter", [true]),
    );
    const outcome = await execute(t, sendEth(t.probe, ETH_LIMIT.perTx));
    expectInnerRevert(outcome, "NotSessionKey");
    expect(await remaining(t, NATIVE)).toBe(ETH_LIMIT.perDay);
    expect(await t.chain.balance(t.probe)).toBe(0n);
  });

  it("matches a reference model for random amounts around the caps (seeded)", async () => {
    const seed = 0xa9e15;
    const random = prng(seed);
    const t = await setup();
    const { perTx, perDay } = TOKEN_LIMIT;
    let spentToday = 0n;
    let sent = 0n;
    const seen = new Set<string>();
    for (let step = 0; step < 60; step++) {
      const label = `seed ${seed}, step ${step}`;
      if (random() < 0.15) {
        t.chain.now = nextUtcDay(t.chain.now) + randomBelow(random, 3600n);
        spentToday = 0n;
        seen.add("rollover");
      } else {
        t.chain.now += randomBelow(random, 600n);
      }
      const left = perDay - spentToday;
      const candidates = [
        perTx - 1n,
        perTx,
        perTx + 1n,
        left,
        left + 1n,
        randomBelow(random, perTx + 1n),
      ];
      const amount = candidates[Math.floor(random() * candidates.length)];
      const expected =
        amount > perTx
          ? "PerTxLimitExceeded"
          : amount > left
            ? "DailyLimitExceeded"
            : null;

      const outcome = await execute(t, sendToken(t.token, ALICE, amount));
      seen.add(expected ?? "ok");
      if (expected) {
        expect(outcome.ok, label).toBe(false);
        const decoded = decodeGuardError(
          new RawContractError({ data: outcome.output }),
        );
        expect(decoded, label).toBe(`On-chain guard rejected: ${expected}`);
      } else {
        expect(outcome.ok, label).toBe(true);
        spentToday += amount;
        sent += amount;
      }
      expect(await remaining(t, t.token), label).toBe(perDay - spentToday);
    }
    expect(await tokenBalance(t, ALICE)).toBe(sent);
    // The seed must exercise every branch, or the run proves little.
    const branches = [
      "ok",
      "PerTxLimitExceeded",
      "DailyLimitExceeded",
      "rollover",
    ];
    expect([...seen].sort()).toEqual(branches.sort());
  });
});

describe("executeApproved", () => {
  it("executes a valid owner approval exactly once, outside the limits", async () => {
    const t = await setup();
    const amount = parseEther("0.5"); // above both caps, to a non-allowlisted address
    const a = approvalFor(t, sendEth(STRANGER.address, amount), 42n);
    const signature = await sign(t.guard, a);
    expectOk(await executeApproved(t, a, signature));
    expect(await t.chain.balance(STRANGER.address)).toBe(amount);
    expect(await readGuard(t, "usedNonce", [42n])).toBe(true);

    expectRejected(await executeApproved(t, a, signature), "NonceUsed");
    expect(await t.chain.balance(STRANGER.address)).toBe(amount);
  });

  it("only the session key can submit it", async () => {
    const t = await setup();
    const a = approvalFor(t, sendEth(ALICE, 1n));
    const signature = await sign(t.guard, a);
    expectRejected(
      await executeApproved(t, a, signature, STRANGER.address),
      "NotSessionKey",
    );
    expectRejected(
      await executeApproved(t, a, signature, OWNER.address),
      "NotSessionKey",
    );
  });

  it("rejects an approval after its deadline", async () => {
    const t = await setup();
    const a = approvalFor(t, sendEth(ALICE, 1n));
    const signature = await sign(t.guard, a);
    t.chain.now = a.deadline + 1n;
    expectRejected(await executeApproved(t, a, signature), "ApprovalExpired");
    t.chain.now = a.deadline;
    expectOk(await executeApproved(t, a, signature));
  });

  it("rejects a signature from anyone but the owner, including the session key", async () => {
    const t = await setup();
    const a = approvalFor(t, sendEth(ALICE, 1n));
    for (const signer of [SESSION, STRANGER]) {
      const signature = await sign(t.guard, a, signer);
      expectRejected(await executeApproved(t, a, signature), "BadSignature");
    }
  });

  it("rejects the high-s twin of a valid signature, which ecrecover alone accepts", async () => {
    const t = await setup();
    const a = approvalFor(t, sendEth(ALICE, 1n));
    const { r, s, v } = splitSignature(await sign(t.guard, a));
    const malleated = joinSignature(r, SECP256K1_N - s, v === 27 ? 28 : 27);
    const hash = hashMessage({ raw: digestOf(t.guard, a) });
    expect(await rawEcrecover(t, hash, malleated)).toBe(OWNER.address);
    expectRejected(await executeApproved(t, a, malleated), "BadSignature");
  });

  it("rejects v values other than 27 and 28", async () => {
    const t = await setup();
    const a = approvalFor(t, sendEth(ALICE, 1n));
    const { r, s, v } = splitSignature(await sign(t.guard, a));
    for (const badV of [v - 27, 0, 1, 29]) {
      const signature = joinSignature(r, s, badV);
      expectRejected(await executeApproved(t, a, signature), "BadSignature");
    }
  });

  it("rejects a signature that recovers to the zero address, and a 64-byte signature", async () => {
    const t = await setup();
    const a = approvalFor(t, sendEth(ALICE, 1n));
    const zeroRecovery = joinSignature(toHex(0, { size: 32 }), 1n, 27);
    const hash = hashMessage({ raw: digestOf(t.guard, a) });
    expect(await rawEcrecover(t, hash, zeroRecovery)).toBe(zeroAddress);
    expectRejected(await executeApproved(t, a, zeroRecovery), "BadSignature");

    const compact = slice(await sign(t.guard, a), 0, 64);
    expectRejected(await executeApproved(t, a, compact), "BadSignature");
  });

  it("binds the signature to the chain ID", async () => {
    const t = await setup();
    const a = approvalFor(t, sendEth(ALICE, 1n));
    const baseMainnet = await sign(t.guard, a, OWNER, 8453n);
    expectRejected(await executeApproved(t, a, baseMainnet), "BadSignature");
    expectOk(await executeApproved(t, a, await sign(t.guard, a)));
  });

  it("binds the signature to the guard address", async () => {
    const t = await setup();
    const twin = await t.chain.deploy(guardInitCode(t.config), GUARD_ETH);
    const a = approvalFor(t, sendEth(ALICE, 1n));
    const forFirstGuard = await sign(t.guard, a);
    const onTwin = await executeApproved(
      t,
      a,
      forFirstGuard,
      SESSION.address,
      twin,
    );
    expectRejected(onTwin, "BadSignature");
    expectOk(await executeApproved(t, a, forFirstGuard));
  });

  const tamperings: [string, (a: Approval) => Approval][] = [
    ["target", (a) => ({ ...a, target: STRANGER.address })],
    ["value", (a) => ({ ...a, value: a.value + 1n })],
    ["calldata", (a) => ({ ...a, data: "0x00" })],
    ["nonce", (a) => ({ ...a, nonce: a.nonce + 1n })],
    ["deadline", (a) => ({ ...a, deadline: a.deadline + 1n })],
  ];

  it.each(tamperings)(
    "binds the signature to the %s",
    async (_field, tamper) => {
      const t = await setup();
      const a = approvalFor(t, sendEth(ALICE, 1n));
      const signature = await sign(t.guard, a);
      expectRejected(
        await executeApproved(t, tamper(a), signature),
        "BadSignature",
      );
      expectOk(await executeApproved(t, a, signature));
    },
  );
});

describe("session lifecycle: revoke, restore, renew", () => {
  const setSessionCall = (t: Fixture, key: Hex, expiry: bigint): Call => ({
    to: t.guard,
    value: 0n,
    data: guardData("setSession", [key, expiry]),
  });

  it("revokeSession blocks both execute and executeApproved", async () => {
    const t = await setup();
    const a = approvalFor(t, sendEth(ALICE, 1n));
    const signature = await sign(t.guard, a);
    expectOk(await admin(t, "revokeSession"));
    expect(await readGuard(t, "sessionKey")).toBe(zeroAddress);
    expect(await readGuard(t, "sessionExpiry")).toBe(0n);
    expectRejected(await execute(t, sendEth(ALICE, 1n)), "NotSessionKey");
    expectRejected(await executeApproved(t, a, signature), "NotSessionKey");
  });

  it("the session key can relay an owner-signed revokeSession", async () => {
    const t = await setup();
    const revoke = { to: t.guard, value: 0n, data: guardData("revokeSession") };
    const a = approvalFor(t, revoke);
    expectOk(await executeApproved(t, a, await sign(t.guard, a)));
    expectRejected(await execute(t, sendEth(ALICE, 1n)), "NotSessionKey");
  });

  it("after a revoke, only a transaction from the owner key restores the session", async () => {
    const t = await setup();
    expectOk(await execute(t, sendEth(ALICE, ETH_LIMIT.perTx)));
    const used = approvalFor(t, sendEth(ALICE, 1n), 7n);
    const usedSignature = await sign(t.guard, used);
    expectOk(await executeApproved(t, used, usedSignature));
    expectOk(await admin(t, "revokeSession"));

    // No relayed renewal: with sessionKey == 0 nobody can call executeApproved.
    const renew = approvalFor(
      t,
      setSessionCall(t, SESSION.address, SESSION_EXPIRY),
      8n,
    );
    const renewSignature = await sign(t.guard, renew);
    for (const relayer of [SESSION.address, STRANGER.address]) {
      const outcome = await executeApproved(t, renew, renewSignature, relayer);
      expectRejected(outcome, "NotSessionKey");
    }

    expectOk(await admin(t, "setSession", [SESSION.address, SESSION_EXPIRY]));
    expectOk(await execute(t, sendEth(ALICE, 1n)));
    // Spend and nonces survive the revoke.
    expect(await remaining(t, NATIVE)).toBe(
      ETH_LIMIT.perDay - ETH_LIMIT.perTx - 1n,
    );
    expectRejected(await executeApproved(t, used, usedSignature), "NonceUsed");
  });

  it("an unused approval signed before a revoke is valid again once the session is restored", async () => {
    const t = await setup();
    const pending = approvalFor(
      t,
      sendEth(STRANGER.address, parseEther("0.1")),
    );
    const signature = await sign(t.guard, pending);
    expectOk(await admin(t, "revokeSession"));
    expectOk(await admin(t, "setSession", [SESSION.address, SESSION_EXPIRY]));
    expectOk(await executeApproved(t, pending, signature));
  });

  it("an expired session can still relay an owner-signed setSession (guard:deploy --renew)", async () => {
    const t = await setup();
    t.chain.now = SESSION_EXPIRY + 1n;
    expectRejected(await execute(t, sendEth(ALICE, 1n)), "SessionExpired");
    const newExpiry = t.chain.now + 7n * DAY;
    const renew = approvalFor(t, setSessionCall(t, SESSION.address, newExpiry));
    expectOk(await executeApproved(t, renew, await sign(t.guard, renew)));
    expect(await readGuard(t, "sessionExpiry")).toBe(newExpiry);
    expectOk(await execute(t, sendEth(ALICE, 1n)));
  });

  it("setSession with a past expiry pauses execute but keeps owner-signed relays working", async () => {
    const t = await setup();
    expectOk(await admin(t, "setSession", [SESSION.address, t.chain.now - 1n]));
    expectRejected(await execute(t, sendEth(ALICE, 1n)), "SessionExpired");
    const a = approvalFor(t, sendEth(ALICE, 1n));
    expectOk(await executeApproved(t, a, await sign(t.guard, a)));
  });

  it("rotating the session key locks out the old key", async () => {
    const t = await setup();
    expectOk(await admin(t, "setSession", [STRANGER.address, SESSION_EXPIRY]));
    expectRejected(await execute(t, sendEth(ALICE, 1n)), "NotSessionKey");
    expectOk(await execute(t, sendEth(ALICE, 1n), STRANGER.address));
  });
});

describe("owner-only administration", () => {
  const adminCalls: [string, unknown[]][] = [
    ["ownerExecute", [ALICE, 1n, "0x"]],
    ["setSession", [STRANGER.address, SESSION_EXPIRY]],
    ["revokeSession", []],
    ["setTarget", [STRANGER.address, true]],
    ["setRecipient", [STRANGER.address, true]],
    ["setLimit", [NATIVE, GUARD_ETH, GUARD_ETH]],
  ];

  it.each(adminCalls)(
    "%s rejects the session key and strangers",
    async (name, args) => {
      const t = await setup();
      for (const caller of [SESSION.address, STRANGER.address]) {
        expectRejected(await admin(t, name, args, caller), "NotOwner");
      }
      expectOk(await admin(t, name, args));
    },
  );

  it("owner changes take effect: recipient removal and new limits", async () => {
    const t = await setup();
    expectOk(await admin(t, "setRecipient", [ALICE, false]));
    expectRejected(await execute(t, sendEth(ALICE, 1n)), "RecipientNotAllowed");
    expectOk(await admin(t, "setRecipient", [ALICE, true]));
    expectOk(await admin(t, "setLimit", [NATIVE, 5n, 10n]));
    expectRejected(await execute(t, sendEth(ALICE, 6n)), "PerTxLimitExceeded");
    expectOk(await execute(t, sendEth(ALICE, 5n)));
  });

  it("ownerExecute moves funds without limits or allowlists", async () => {
    const t = await setup();
    const amount = parseEther("0.5");
    expectOk(await admin(t, "ownerExecute", [STRANGER.address, amount, "0x"]));
    expect(await t.chain.balance(STRANGER.address)).toBe(amount);
  });
});

describe("rule 12: TypeScript digest parity", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  /** Points src/lib/chain.ts at the in-process guard. `rpcDigest` simulates a lying RPC. */
  function useInProcessGuard(t: Fixture, rpcDigest?: Hex) {
    vi.stubEnv("GUARD_ADDRESS", t.guard);
    vi.stubEnv("VAULT_PRIVATE_KEY", OWNER_KEY);
    type Read = {
      address: Hex;
      abi: Abi;
      functionName: string;
      args?: unknown[];
    };
    const readContract = async ({ address, abi, functionName, args }: Read) => {
      if (rpcDigest && functionName === "approvalDigest") return rpcDigest;
      return t.chain.read(address, abi, functionName, args ?? []);
    };
    vi.spyOn(publicClient, "readContract").mockImplementation(
      readContract as never,
    );
  }

  function randomCall(random: () => number): Call {
    return {
      to: randomHex(random, 20),
      value: randomBelow(random, parseEther("0.001")),
      data: randomHex(random, Math.floor(random() * 100)),
    };
  }

  it("the approvalDigest view equals the layout signed in this suite (random inputs)", async () => {
    const random = prng(0x12);
    const t = await setup();
    for (let i = 0; i < 25; i++) {
      const inner = randomCall(random);
      const a: Approval = {
        target: inner.to,
        value: hexToBigInt(randomHex(random, 32)),
        data: inner.data ?? "0x",
        nonce: hexToBigInt(randomHex(random, 32)),
        deadline: hexToBigInt(randomHex(random, 32)),
      };
      const args = [a.target, a.value, a.data, a.nonce, a.deadline];
      const onChain = await readGuard<Hex>(t, "approvalDigest", args);
      expect(onChain).toBe(digestOf(t.guard, a));
    }
  });

  it("signOwnerApproval's local digest matches the contract, and its signature executes", async () => {
    const random = prng(0x34);
    const t = await setup();
    useInProcessGuard(t);
    // signOwnerApproval sets the deadline from the wall clock.
    t.chain.now = BigInt(Math.floor(Date.now() / 1000));
    for (let i = 0; i < 12; i++) {
      const inner = randomCall(random);
      // Throws if localApprovalDigest differs from the contract's approvalDigest.
      const approval = await signOwnerApproval(inner);
      const outer = outerCall(inner, approval);
      expect(outer.to).toBe(t.guard);
      expectOk(
        await t.chain.send(SESSION.address, outer.to, outer.data ?? "0x"),
      );
    }
  });

  it("signOwnerApproval refuses to sign when the RPC reports a different digest", async () => {
    const t = await setup();
    useInProcessGuard(t, keccak256("0x01"));
    await expect(signOwnerApproval(sendEth(ALICE, 1n))).rejects.toThrow(
      "does not match the local computation",
    );
  });
});
