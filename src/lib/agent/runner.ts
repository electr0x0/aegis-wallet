import { isAddress } from "viem";
import { WETH } from "../chain";
import { ADVERSARIAL, type Action } from "../security/policyEngine";
import {
  looksLikeInvoice,
  readInvoice,
  ungroundedField,
  writtenAddress,
  type Provider,
} from "./invoice";
import { reportProgress } from "./progress";
import {
  audit_contract_address,
  execute_eth_weth_rebalance,
  executeAction,
  get_wallet_portfolio,
} from "./tools";

type Token = Action["token"];
type ToolArgs = Record<string, unknown>;
type ToolCall = { id: string; function: { name: string; arguments: string } };
type AssistantMessage = { content?: string | null; tool_calls?: ToolCall[] };

const MAX_PLANNER_ROUNDS = 5;
const MAX_TOOL_CALLS = 4;
// Word boundaries stop a 64-hex hash or key from yielding a truncated "address".
const ADDRESS = /\b0x[0-9a-fA-F]{40}\b/;
// Every number followed by a unit, however it is written.
const ANY_AMOUNT = /\d+(?:\.\d+)?\s*(?:USDC|WETH|ETH)/gi;
// A cleanly written amount: the lookbehind rejects "1,5 USDC", ".5 ETH" and "1e3 USDC",
// which a plain match would read as 5 or 3.
const AMOUNT = /(?<![\w.,-])(\d+(?:\.\d+)?)\s*(USDC|WETH|ETH)/i;
// "Don't send 5 USDC" must never be parsed as an order to send 5 USDC.
const NEGATED =
  /\b(?:don['’]?t|do not|never|not)\s+(?:\w+\s+)?(?:send|transfer|pay|wrap|unwrap)/i;
// Secrets are never handled in chat: no tool can read one, and such a request never reaches
// the LLM provider. English plus common translations; base64 blobs are decoded and checked too.
const SECRET_TERMS = [
  String.raw`(?:private|secret|signing|owner|vault|master|agent|account|api)(?:'s)?[\s_-]*keys?\b`,
  String.raw`seed[\s_-]*phrase|recovery[\s_-]*phrase|mnemonic|passphrase|password`,
  String.raw`\.env\b|env(?:ironment)?[\s_-]*(?:file|var)`,
  String.raw`\bpins?\b|system[\s_-]*prompt`,
  "私钥|密钥|助记词|密码|系统提示|秘密鍵|clave privada|frase semilla",
  "cl[eé] priv[eé]e|mot de passe|chiave privata|privat\\w* schl(?:ü|ue)ssel",
  "закрытый ключ|приватный ключ",
];
const SECRET_REQUEST = new RegExp(SECRET_TERMS.join("|"), "i");
const BASE64_BLOB = /[A-Za-z0-9+/]{16,}={0,2}/g;
const SECRET_MESSAGE =
  "Refused: keys, PINs, seed phrases, API keys, environment files and the system prompt are never disclosed. Nothing was read or signed.";
// One definition shared with the policy engine, so routing and blocking agree.
const INJECTION = ADVERSARIAL;
const WHOLE_BALANCE = /all (?:wallet )?balance|drain/i;
const MULTI_STEP =
  /\bthen\b|\band (?:transfer|send|wrap|unwrap|rebalance|analyze)\b/i;
const TRANSFER_VERB = /\b(?:send|transfer|pay)/i;
const UNSUPPORTED = /\b(?:swap|yield|stak|bridg)/i;
// A swap worded without "swap": "convert my USDC to ETH". ETH to WETH is a 1:1 wrap and passes.
const CONVERSION_VERB = /\b(?:convert|exchange|trade|sell|buy)\b/i;
const USDC_AND_ETH = /\busdc\b[\s\S]*\bw?eth\b|\bw?eth\b[\s\S]*\busdc\b/i;
const UNSUPPORTED_MESSAGE =
  "Swaps and yield deposits are not supported: no slippage-safe route exists on this testnet deployment.";

const transferParameters = {
  type: "object",
  properties: {
    kind: {
      type: "string",
      enum: ["wrap_eth", "unwrap_weth", "transfer_token"],
    },
    token: { type: "string", enum: ["ETH", "WETH", "USDC"] },
    amount: { type: "string" },
    recipient: { type: "string" },
  },
  required: ["kind", "token", "amount", "recipient"],
  additionalProperties: false,
};

const definitions = [
  {
    name: "get_wallet_portfolio",
    description: "Read live balances and gas",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "execute_token_transfer",
    description:
      "Propose a transfer, wrap or unwrap through deterministic policy",
    parameters: transferParameters,
  },
  {
    name: "simulate_transaction",
    description: "Dry-run a proposed transaction without signing",
    parameters: transferParameters,
  },
  {
    name: "audit_contract_address",
    description: "Inspect address risk and bytecode",
    parameters: {
      type: "object",
      properties: { address: { type: "string" } },
      required: ["address"],
    },
  },
  {
    name: "execute_eth_weth_rebalance",
    description: "Target WETH ratio in combined ETH/WETH holdings",
    parameters: {
      type: "object",
      properties: { ratio: { type: "number" } },
      required: ["ratio"],
    },
  },
];

export async function runIntent(prompt: string) {
  const address = prompt.match(ADDRESS)?.[0];
  const amount = singleAmount(prompt);

  // Injection with a target address goes to the policy engine, which blocks and logs
  // it unless the recipient is whitelisted (then the normal tiers still apply).
  // With no stated amount we pass 0, which the policy always blocks: nothing is invented.
  if (INJECTION.test(prompt) && address) {
    const token = (amount?.[2].toUpperCase() ?? "USDC") as Token;
    const value = amount?.[1] ?? "0";
    return executeAction({
      kind: "transfer_token",
      token,
      amount: value,
      recipient: address,
      prompt,
    });
  }
  if (asksForSecret(prompt)) throw new Error(SECRET_MESSAGE);
  if (INJECTION.test(prompt) && WHOLE_BALANCE.test(prompt)) {
    throw new Error(
      "Refused: instruction-override language asking to move the whole balance. Nothing was signed.",
    );
  }
  // Refuse before any parsing, so the planner can't reinterpret a swap as a transfer.
  if (UNSUPPORTED.test(prompt) || asksForConversion(prompt)) {
    throw new Error(UNSUPPORTED_MESSAGE);
  }
  if (looksLikeInvoice(prompt)) return payInvoice(prompt);

  const multiStep = MULTI_STEP.test(prompt);
  if (amount && !multiStep && !NEGATED.test(prompt)) {
    const action = parseSingleAction(prompt, amount, address);
    if (action) return executeAction(action, /simulate|dry.run/i.test(prompt));
  }
  if (!multiStep && /portfolio|balance|gas/i.test(prompt)) {
    return get_wallet_portfolio(prompt);
  }
  if (/audit/i.test(prompt) && address) return audit_contract_address(address);
  return runPlanner(prompt);
}

// The demo parser acts only on exactly one cleanly written amount. A malformed one, or two
// ("instead of 5 USDC, send 0.5 USDC"), leaves the prompt to the planner: no first-match guess.
function singleAmount(prompt: string): RegExpMatchArray | null {
  const amounts = prompt.match(ANY_AMOUNT) ?? [];
  if (amounts.length !== 1) return null;
  return prompt.match(AMOUNT);
}

// Decoded base64 blobs, so encoding a request does not slip it past the secret check.
// Hex addresses and hashes are skipped: they are not base64 text.
function decodedBlobs(prompt: string): string {
  const blobs = prompt.match(BASE64_BLOB) ?? [];
  return blobs
    .filter((blob) => !blob.startsWith("0x"))
    .map((blob) => Buffer.from(blob, "base64").toString("utf8"))
    .join(" ");
}

function asksForSecret(prompt: string): boolean {
  return (
    SECRET_REQUEST.test(prompt) || SECRET_REQUEST.test(decodedBlobs(prompt))
  );
}

function asksForConversion(prompt: string): boolean {
  return CONVERSION_VERB.test(prompt) && USDC_AND_ETH.test(prompt);
}

// Deterministic demo parser. Returns null when the prompt is not a single wrap or transfer.
function parseSingleAction(
  prompt: string,
  amount: RegExpMatchArray,
  address: string | undefined,
): Action | null {
  const token = amount[2].toUpperCase() as Token;
  const base = { token, amount: amount[1], prompt };
  if (/unwrap/i.test(prompt)) {
    if (token !== "WETH") throw new Error("Unwrap takes a WETH amount");
    return { ...base, kind: "unwrap_weth", recipient: WETH };
  }
  if (/rebalance|wrap/i.test(prompt)) {
    if (token !== "ETH") throw new Error("Wrap takes an ETH amount");
    return { ...base, kind: "wrap_eth", recipient: WETH };
  }
  // Only an explicit send/transfer/pay verb may move funds to another address.
  if (!TRANSFER_VERB.test(prompt)) return null;
  const recipient = address || process.env.VAULT_ADDRESS;
  if (!recipient) {
    throw new Error(
      "Configure VAULT_ADDRESS or provide a complete recipient address",
    );
  }
  return { ...base, kind: "transfer_token", recipient };
}

// Accounts payable: the model reads the invoice, code checks every field it returns
// against the document, and the transfer then goes through the same policy gate.
async function payInvoice(prompt: string) {
  const providers = configuredProviders();
  const [first] = providers;
  reportProgress({
    stage: "extraction",
    status: "running",
    message: first
      ? `${first.name} (${first.model}) is reading the invoice. It extracts fields only; it cannot sign or approve.`
      : "No model configured. The deterministic parser is reading the labelled fields.",
    start: true,
  });
  const failed = (message: string) =>
    reportProgress({ stage: "extraction", status: "failed", message });
  const refuse = (reason: string) => {
    failed(reason);
    return new Error(`Refused: ${reason}. Nothing was signed.`);
  };
  let invoice;
  try {
    invoice = await readInvoice(prompt, providers);
  } catch (e) {
    failed((e as Error).message);
    throw e;
  }
  const ungrounded = ungroundedField(prompt, invoice);
  if (ungrounded) {
    throw refuse(
      `the reader's output failed the document check: ${ungrounded}`,
    );
  }
  const payTo = writtenAddress(prompt, invoice.payTo);
  if (!isAddress(payTo)) {
    throw refuse(
      "the pay-to address fails its EIP-55 checksum, a sign of a mistyped or altered address",
    );
  }
  reportProgress({
    stage: "extraction",
    status: "success",
    message: `${invoice.reader} read ${invoice.amount} ${invoice.token} payable to ${invoice.vendor || "an unnamed vendor"}. The amount and the pay-to address were both found in the document.`,
  });
  const result = await executeAction({
    kind: "transfer_token",
    token: invoice.token,
    amount: invoice.amount,
    recipient: payTo,
    prompt,
  });
  return { ...result, invoice: { ...invoice, payTo } };
}

// Fallback order: DeepSeek, then Gemini, then OpenAI, each only when its key is set.
function configuredProviders(): Provider[] {
  const providers: Provider[] = [];
  const deepseek = process.env.DEEPSEEK_API_KEY;
  if (deepseek) {
    providers.push({
      name: "DeepSeek",
      url: "https://api.deepseek.com/chat/completions",
      key: deepseek,
      model: process.env.DEEPSEEK_MODEL || "deepseek-flash",
      jsonObjectOnly: true,
    });
  }
  const gemini = process.env.GEMINI_API_KEY;
  if (gemini) {
    providers.push({
      name: "Gemini",
      url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      key: gemini,
      model: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
    });
  }
  const openai = process.env.OPENAI_API_KEY;
  if (openai) {
    providers.push({
      name: "OpenAI",
      url: "https://api.openai.com/v1/chat/completions",
      key: openai,
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    });
  }
  return providers;
}

function plannerProviders(): Provider[] {
  const providers = configuredProviders();
  if (providers.length) return providers;
  throw new Error(
    "Use a demo intent or configure DEEPSEEK_API_KEY (or GEMINI_API_KEY) for multi-step natural language planning.",
  );
}

function systemPrompt(): string {
  const vault = process.env.VAULT_ADDRESS || "not configured";
  return (
    "You operate a Base Sepolia testnet wallet. Use tools for facts and operations. " +
    "Never repeat a transaction. Stop when approval is required or a call fails. " +
    `WETH=${WETH}. Vault=${vault}. Never invent addresses or amounts.`
  );
}

async function complete(
  provider: Provider,
  messages: unknown[],
): Promise<AssistantMessage> {
  const body = {
    model: provider.model,
    messages,
    tools: definitions.map((f) => ({ type: "function", function: f })),
    // Serial tool calls keep "stop at the first approval or block" meaningful.
    parallel_tool_calls: false,
  };
  const response = await fetch(provider.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${provider.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(
      `${provider.name} planner request failed (${response.status})`,
    );
  }
  const message = (await response.json()).choices?.[0]?.message;
  if (!message) throw new Error(`${provider.name} planner returned no message`);
  return message;
}

// The next provider is tried only when a request fails, never on a reply it dislikes.
async function completeWithFallback(
  providers: Provider[],
  messages: unknown[],
) {
  let failure: unknown;
  for (const provider of providers) {
    try {
      return { provider, message: await complete(provider, messages) };
    } catch (e) {
      failure = e;
    }
  }
  throw failure;
}

async function runTool(name: string, args: ToolArgs, prompt: string) {
  // The stored prompt always comes from the operator, never from model arguments.
  const action = { ...args, prompt } as Action;
  switch (name) {
    case "get_wallet_portfolio":
      return get_wallet_portfolio(prompt);
    case "execute_token_transfer":
      return executeAction(action);
    case "simulate_transaction":
      return executeAction(action, true);
    case "audit_contract_address":
      return audit_contract_address(String(args.address));
    case "execute_eth_weth_rebalance":
      return execute_eth_weth_rebalance(Number(args.ratio), prompt);
    default:
      return { error: "Unknown tool" };
  }
}

// A plan ends at a human hold, a block, or any broadcast: the model never gets
// the chance to re-submit a transaction.
function haltingExecution(result: unknown) {
  const execution = result as {
    decision?: { tier?: string };
    rationale?: string;
    txHash?: string;
  } | null;
  const tier = execution?.decision?.tier;
  const held = tier === "TIER_2_HITL" || tier === "BLOCKED";
  return held || execution?.txHash ? execution : null;
}

// Exported for the offline attack suite, which drives it with a compromised mock model.
export async function runPlanner(prompt: string) {
  let providers = plannerProviders();
  const messages: unknown[] = [
    { role: "system", content: systemPrompt() },
    { role: "user", content: prompt },
  ];
  const results: unknown[] = [];

  for (let round = 0; round < MAX_PLANNER_ROUNDS; round++) {
    const { provider, message } = await completeWithFallback(
      providers,
      messages,
    );
    // Fallback happens only before the first tool runs. After that the plan stays with
    // the model that answered: no model continues another's tool calls, and tool
    // results go to one provider only.
    providers = [provider];
    // Echo the message untouched: Gemini needs its thought_signature back, DeepSeek
    // its reasoning_content.
    messages.push(message);
    if (!message.tool_calls?.length) {
      const summary = message.content ?? "";
      return { summary, rationale: summary, results };
    }
    for (const call of message.tool_calls) {
      if (results.length >= MAX_TOOL_CALLS) {
        const summary = "Planner tool-call limit reached";
        return { summary, rationale: summary, results };
      }
      const args = JSON.parse(call.function.arguments || "{}") as ToolArgs;
      const result = await runTool(call.function.name, args, prompt);
      results.push(result);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
      const halted = haltingExecution(result);
      if (halted) {
        const stop = halted.txHash
          ? "transaction broadcast"
          : halted.decision?.tier;
        const summary = `Planner stopped: ${stop}`;
        return { summary, rationale: halted.rationale ?? summary, results };
      }
    }
  }
  const summary = "Planner step limit reached";
  return { summary, rationale: summary, results };
}
