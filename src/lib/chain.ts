import {
  BaseError,
  ContractFunctionRevertedError,
  bytesToBigInt,
  createPublicClient,
  createWalletClient,
  decodeErrorResult,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  formatEther,
  formatUnits,
  http,
  isAddress,
  isAddressEqual,
  isHex,
  keccak256,
  parseAbi,
  parseAbiParameters,
  parseEventLogs,
  parseUnits,
  zeroAddress,
  zeroHash,
  type Abi,
  type Hex,
  type Log,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import artifact from "./guard/AgentGuard.json";
import {
  EAS_ADDRESS,
  LEDGER_ANCHOR_SCHEMA,
  LEDGER_ANCHOR_SCHEMA_UID,
  SCHEMA_REGISTRY_ADDRESS,
  schemaUid,
  type Action,
  type AnchorCall,
} from "./security/policyEngine";
import { currentAccount } from "./auth/context";

export const WETH = "0x4200000000000000000000000000000000000006";
export const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
export const EXPLORER = "https://sepolia.basescan.org";
export const abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
  "function deposit() payable",
  "function withdraw(uint256)",
]);
export const guardAbi = artifact.abi as Abi;
// Subset of EAS v1.2.0 (eas-contracts IEAS.sol and ISchemaRegistry.sol), as deployed on Base Sepolia.
export const easAbi = parseAbi([
  "struct AttestationRequestData { address recipient; uint64 expirationTime; bool revocable; bytes32 refUID; bytes data; uint256 value; }",
  "struct AttestationRequest { bytes32 schema; AttestationRequestData data; }",
  "struct SchemaRecord { bytes32 uid; address resolver; bool revocable; string schema; }",
  "function attest(AttestationRequest request) payable returns (bytes32)",
  "event Attested(address indexed recipient, address indexed attester, bytes32 uid, bytes32 indexed schemaUID)",
  "function register(string schema, address resolver, bool revocable) returns (bytes32)",
  "function getSchema(bytes32 uid) view returns (SchemaRecord)",
]);

const REFERENCE_ETH_USD = 2500;
const APPROVAL_TTL_SECONDS = 600n;
const DAY_MS = 86_400_000;
const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;

export type Call = { to: Hex; value: bigint; data?: Hex };
export type OwnerApproval = { nonce: bigint; deadline: bigint; signature: Hex };
export type GuardStatus = {
  address: Hex;
  owner: Hex;
  sessionKey: Hex;
  sessionExpiry: number; // unix seconds
  limits: {
    asset: "ETH" | "WETH" | "USDC";
    perTx: string;
    perDay: string;
    spentToday: string;
  }[];
};

// The guard tracks native ETH under the zero address.
const GUARDED_ASSETS = [
  { asset: "ETH", address: zeroAddress, decimals: 18 },
  { asset: "WETH", address: WETH, decimals: 18 },
  { asset: "USDC", address: USDC, decimals: 6 },
] as const;
type GuardedAsset = (typeof GUARDED_ASSETS)[number];

// ---------------------------------------------------------------- clients and keys

function transport() {
  const url = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
  return http(url, { timeout: 15000, retryCount: 1 });
}

export const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: transport(),
});

function privateKey(name: string, missing: string): Hex {
  const key = process.env[name];
  if (!key || !PRIVATE_KEY_PATTERN.test(key)) throw new Error(missing);
  return key as Hex;
}

/** The agent EOA. It is the guard's session key and pays gas. */
export function account() {
  const context = currentAccount();
  if (context) return privateKeyToAccount(context.key);
  const missing =
    "Wallet not configured. Run pnpm setup-wallets and fund the printed addresses.";
  return privateKeyToAccount(privateKey("AGENT_PRIVATE_KEY", missing));
}

/** Stable seal signer for the combined audit history, across account switches. */
export function ledgerSigner() {
  return privateKeyToAccount(
    privateKey("AGENT_PRIVATE_KEY", "Master key not configured"),
  );
}

export function wallet() {
  return createWalletClient({
    account: account(),
    chain: baseSepolia,
    transport: transport(),
  });
}

function ownerAccount() {
  const missing =
    "VAULT_PRIVATE_KEY not configured. It is the AgentGuard owner key.";
  return privateKeyToAccount(privateKey("VAULT_PRIVATE_KEY", missing));
}

// ---------------------------------------------------------------- calls

export const tokenDecimals = (token: Action["token"]) =>
  token === "USDC" ? 6 : 18;

// Fixed zero-value EAS calls. Target, value and schema never come from the action.
function anchorTransaction(a: Action): Call {
  if (a.kind === "register_anchor_schema") {
    const data = encodeFunctionData({
      abi: easAbi,
      functionName: "register",
      args: [LEDGER_ANCHOR_SCHEMA, zeroAddress, false],
    });
    return { to: SCHEMA_REGISTRY_ADDRESS, value: 0n, data };
  }
  if (!a.anchor) throw new Error("Ledger anchor data missing");
  const payload = encodeAbiParameters(
    parseAbiParameters(LEDGER_ANCHOR_SCHEMA),
    [
      a.anchor.ledgerHead as Hex,
      BigInt(a.anchor.entryCount),
      a.anchor.policyHash as Hex,
    ],
  );
  const request = {
    schema: LEDGER_ANCHOR_SCHEMA_UID,
    data: {
      recipient: zeroAddress,
      expirationTime: 0n,
      revocable: false,
      refUID: zeroHash,
      data: payload,
      value: 0n,
    },
  };
  const data = encodeFunctionData({
    abi: easAbi,
    functionName: "attest",
    args: [request],
  });
  return { to: EAS_ADDRESS, value: 0n, data };
}

/** Decodes an EAS call for the policy: target, total value and the schema UID it uses. */
export function anchorCall(call: Call): AnchorCall {
  try {
    const decoded = decodeFunctionData({
      abi: easAbi,
      data: call.data ?? "0x",
    });
    if (decoded.functionName === "attest") {
      const { schema, data } = decoded.args[0];
      const value = call.value + data.value;
      return { to: call.to, value, schemaUid: schema };
    }
    if (decoded.functionName === "register") {
      const uid = schemaUid(...decoded.args);
      return { to: call.to, value: call.value, schemaUid: uid };
    }
  } catch {
    // Not an EAS call: the policy blocks a missing schema.
  }
  return { to: call.to, value: call.value };
}

/** The attestation UID from our schema's Attested event in a mined receipt. */
export function attestationUid(logs: Log[]): Hex | undefined {
  const events = parseEventLogs({ abi: easAbi, eventName: "Attested", logs });
  const ours = events.find(
    (e) =>
      isAddressEqual(e.address, EAS_ADDRESS) &&
      e.args.schemaUID === LEDGER_ANCHOR_SCHEMA_UID,
  );
  return ours?.args.uid;
}

/** True when the fixed ledger anchor schema is already in the SchemaRegistry. */
export async function anchorSchemaRegistered(): Promise<boolean> {
  const record = await publicClient.readContract({
    address: SCHEMA_REGISTRY_ADDRESS,
    abi: easAbi,
    functionName: "getSchema",
    args: [LEDGER_ANCHOR_SCHEMA_UID],
  });
  return record.uid === LEDGER_ANCHOR_SCHEMA_UID;
}

/** The raw inner call for an action, as if sent straight from the address holding the funds. */
export function transaction(a: Action): Call {
  if (a.kind === "register_anchor_schema" || a.kind === "anchor_ledger") {
    return anchorTransaction(a);
  }
  const amount = parseUnits(a.amount, tokenDecimals(a.token));
  if (amount <= 0n) throw new Error("Amount must be positive");
  if (a.kind === "wrap_eth") {
    return {
      to: WETH,
      value: amount,
      data: encodeFunctionData({ abi, functionName: "deposit" }),
    };
  }
  if (a.kind === "unwrap_weth") {
    const data = encodeFunctionData({
      abi,
      functionName: "withdraw",
      args: [amount],
    });
    return { to: WETH, value: 0n, data };
  }
  const recipient = a.recipient as Hex;
  if (a.token === "ETH") return { to: recipient, value: amount };
  const data = encodeFunctionData({
    abi,
    functionName: "transfer",
    args: [recipient, amount],
  });
  return { to: a.token === "USDC" ? USDC : WETH, value: 0n, data };
}

export function guardAddress(): Hex | null {
  if (currentAccount()?.guard === false) return null;
  const value = process.env.GUARD_ADDRESS;
  if (!value) return null;
  // A typo must fail loudly, never fall back to the unlimited EOA path.
  if (!isAddress(value))
    throw new Error("GUARD_ADDRESS is set but is not a valid address");
  return value;
}

/** Where the funds live: the guard contract when deployed, otherwise the agent EOA. */
export function holderAddress(): Hex {
  return guardAddress() ?? account().address;
}

/** Wraps an inner call in guard.execute, or guard.executeApproved when the owner signed it. */
export function outerCall(inner: Call, approval?: OwnerApproval): Call {
  const guard = guardAddress();
  if (!guard) return inner;
  const data = inner.data ?? "0x";
  const callData = approval
    ? encodeFunctionData({
        abi: guardAbi,
        functionName: "executeApproved",
        args: [
          inner.to,
          inner.value,
          data,
          approval.nonce,
          approval.deadline,
          approval.signature,
        ],
      })
    : encodeFunctionData({
        abi: guardAbi,
        functionName: "execute",
        args: [inner.to, inner.value, data],
      });
  return { to: guard, value: 0n, data: callData };
}

// ---------------------------------------------------------------- guard reads

function readGuard<T>(
  guard: Hex,
  functionName: string,
  args: readonly unknown[] = [],
) {
  return publicClient.readContract({
    address: guard,
    abi: guardAbi,
    functionName,
    args,
  }) as Promise<T>;
}

function requireGuard(): Hex {
  const guard = guardAddress();
  if (!guard) {
    throw new Error("GUARD_ADDRESS not configured. Run pnpm guard:deploy.");
  }
  return guard;
}

// Mirrors AgentGuard.approvalDigest so the RPC is never trusted with what the owner signs.
function localApprovalDigest(
  guard: Hex,
  inner: Call,
  nonce: bigint,
  deadline: bigint,
): Hex {
  const types = parseAbiParameters(
    "uint256, address, address, uint256, bytes32, uint256, uint256",
  );
  const dataHash = keccak256(inner.data ?? "0x");
  const chainId = BigInt(baseSepolia.id);
  return keccak256(
    encodeAbiParameters(types, [
      chainId,
      guard,
      inner.to,
      inner.value,
      dataHash,
      nonce,
      deadline,
    ]),
  );
}

/** Owner (VAULT_PRIVATE_KEY) signs one exact inner call for guard.executeApproved. */
export async function signOwnerApproval(inner: Call): Promise<OwnerApproval> {
  const guard = requireGuard();
  const owner = ownerAccount();
  const onChainOwner = await readGuard<Hex>(guard, "owner");
  if (!isAddressEqual(onChainOwner, owner.address)) {
    throw new Error("VAULT_PRIVATE_KEY is not the owner of GUARD_ADDRESS");
  }

  const nonce = bytesToBigInt(crypto.getRandomValues(new Uint8Array(32)));
  const deadline = BigInt(Math.floor(Date.now() / 1000)) + APPROVAL_TTL_SECONDS;
  const digest = await readGuard<Hex>(guard, "approvalDigest", [
    inner.to,
    inner.value,
    inner.data ?? "0x",
    nonce,
    deadline,
  ]);
  if (digest !== localApprovalDigest(guard, inner, nonce, deadline)) {
    throw new Error(
      "Guard approval digest does not match the local computation. Refusing to sign.",
    );
  }

  const signature = await owner.signMessage({ message: { raw: digest } });
  return { nonce, deadline, signature };
}

async function readLimit(
  guard: Hex,
  { asset, address, decimals }: GuardedAsset,
) {
  const [perTx, perDay, spent, day] = await readGuard<
    readonly [bigint, bigint, bigint, bigint]
  >(guard, "limits", [address]);
  // The contract resets `spent` lazily on the first spend of a new UTC day.
  const today = BigInt(Math.floor(Date.now() / DAY_MS));
  const spentToday = day === today ? spent : 0n;
  return {
    asset,
    perTx: formatUnits(perTx, decimals),
    perDay: formatUnits(perDay, decimals),
    spentToday: formatUnits(spentToday, decimals),
  };
}

export async function guardStatus(): Promise<GuardStatus | null> {
  const guard = guardAddress();
  if (!guard) return null;
  const [owner, sessionKey, sessionExpiry, limits] = await Promise.all([
    readGuard<Hex>(guard, "owner"),
    readGuard<Hex>(guard, "sessionKey"),
    readGuard<bigint>(guard, "sessionExpiry"),
    Promise.all(GUARDED_ASSETS.map((asset) => readLimit(guard, asset))),
  ]);
  return {
    address: guard,
    owner,
    sessionKey,
    sessionExpiry: Number(sessionExpiry),
    limits,
  };
}

// ---------------------------------------------------------------- guard errors

// Same lookup as viem's internal getRevertErrorData: raw call / estimateGas errors carry the
// revert bytes on the deepest cause.
function rawRevertData(e: BaseError): Hex | undefined {
  const root = e.walk() as { data?: unknown };
  const data =
    typeof root?.data === "object"
      ? (root.data as { data?: unknown })?.data
      : root?.data;
  return isHex(data) ? data : undefined;
}

function decodeRevert(data: Hex | undefined) {
  if (!data || data === "0x") return undefined;
  try {
    return decodeErrorResult({ abi: guardAbi, data });
  } catch {
    return undefined;
  }
}

function describe(
  errorName: string,
  args: readonly unknown[] | undefined,
): string {
  if (errorName !== "CallFailed") {
    return `On-chain guard rejected: ${errorName}`;
  }
  // The guard allowed the call, but the target itself reverted.
  const inner = decodeRevert(args?.[0] as Hex | undefined);
  if (!inner) return "On-chain guard: inner call reverted";
  const reason =
    inner.errorName === "Error" ? String(inner.args?.[0]) : inner.errorName;
  return `On-chain guard: inner call reverted (${reason})`;
}

/** e.g. "On-chain guard rejected: DailyLimitExceeded", or null when it is not a guard revert. */
export function decodeGuardError(e: unknown): string | null {
  if (!(e instanceof BaseError)) return null;
  const reverted = e.walk(
    (err) => err instanceof ContractFunctionRevertedError,
  );
  if (reverted instanceof ContractFunctionRevertedError && reverted.data) {
    return describe(reverted.data.errorName, reverted.data.args);
  }
  const decoded = decodeRevert(rawRevertData(e));
  return decoded ? describe(decoded.errorName, decoded.args) : null;
}

// ---------------------------------------------------------------- portfolio

function tokenBalance(token: Hex, owner: Hex) {
  return publicClient.readContract({
    address: token,
    abi,
    functionName: "balanceOf",
    args: [owner],
  });
}

/** Balance of the address holding the funds (guard or EOA), in base units. */
export function holderBalance(token: Action["token"]): Promise<bigint> {
  const holder = holderAddress();
  if (token === "ETH") return publicClient.getBalance({ address: holder });
  return tokenBalance(token === "USDC" ? USDC : WETH, holder);
}

export async function portfolio() {
  const holder = holderAddress();
  const agent = account().address;
  const mode: "guard" | "eoa" = guardAddress() ? "guard" : "eoa";
  const [eth, weth, usdc, agentGas, gasPrice] = await Promise.all([
    publicClient.getBalance({ address: holder }),
    tokenBalance(WETH, holder),
    tokenBalance(USDC, holder),
    publicClient.getBalance({ address: agent }),
    publicClient.getGasPrice(),
  ]);
  const balances = {
    ETH: formatEther(eth),
    WETH: formatEther(weth),
    USDC: formatUnits(usdc, 6),
  };
  // Treasury value counts the holder only. In guard mode the agent EOA's ETH is gas money.
  const ethUsd =
    (Number(balances.ETH) + Number(balances.WETH)) * REFERENCE_ETH_USD;
  return {
    address: holder,
    holder,
    agent,
    mode,
    vault: process.env.VAULT_ADDRESS || null,
    balances,
    agentGasEth: formatEther(agentGas),
    gasGwei: Number(formatUnits(gasPrice, 9)),
    totalUsd: ethUsd + Number(balances.USDC),
    referenceEthUsd: REFERENCE_ETH_USD,
  };
}
