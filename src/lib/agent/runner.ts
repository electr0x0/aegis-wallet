import { WETH } from "../chain";
import { ADVERSARIAL, type Action } from "../security/policyEngine";
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
type Provider = { url: string; key: string; model: string };

const MAX_PLANNER_ROUNDS = 5;
const MAX_TOOL_CALLS = 4;
// Word boundaries stop a 64-hex hash or key from yielding a truncated "address".
const ADDRESS = /\b0x[0-9a-fA-F]{40}\b/;
const AMOUNT = /(\d+(?:\.\d+)?)\s*(USDC|WETH|ETH)/i;
// One definition shared with the policy engine, so routing and blocking agree.
const INJECTION = ADVERSARIAL;
const WHOLE_BALANCE = /all (?:wallet )?balance|drain/i;
const MULTI_STEP =
  /\bthen\b|\band (?:transfer|send|wrap|unwrap|rebalance|analyze)\b/i;
const TRANSFER_VERB = /\b(?:send|transfer|pay)/i;
const UNSUPPORTED = /\b(?:swap|yield|stak|bridg)/i;
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
  const amount = prompt.match(AMOUNT);

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
  if (INJECTION.test(prompt) && WHOLE_BALANCE.test(prompt)) {
    throw new Error(
      "Refused: instruction-override language asking to move the whole balance. Nothing was signed.",
    );
  }
  // Refuse before any parsing, so the planner can't reinterpret a swap as a transfer.
  if (UNSUPPORTED.test(prompt)) throw new Error(UNSUPPORTED_MESSAGE);

  const multiStep = MULTI_STEP.test(prompt);
  if (amount && !multiStep) {
    const action = parseSingleAction(prompt, amount, address);
    if (action) return executeAction(action, /simulate|dry.run/i.test(prompt));
  }
  if (!multiStep && /portfolio|balance|gas/i.test(prompt)) {
    return get_wallet_portfolio(prompt);
  }
  if (/audit/i.test(prompt) && address) return audit_contract_address(address);
  return runPlanner(prompt);
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

function plannerProvider(): Provider {
  const gemini = process.env.GEMINI_API_KEY;
  if (gemini) {
    return {
      url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      key: gemini,
      model: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
    };
  }
  const openai = process.env.OPENAI_API_KEY;
  if (openai) {
    return {
      url: "https://api.openai.com/v1/chat/completions",
      key: openai,
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    };
  }
  throw new Error(
    "Use a demo intent or configure GEMINI_API_KEY (or OPENAI_API_KEY) for multi-step natural language planning.",
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
    throw new Error(`Planner request failed (${response.status})`);
  }
  const message = (await response.json()).choices?.[0]?.message;
  if (!message) throw new Error("Planner returned no message");
  return message;
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

async function runPlanner(prompt: string) {
  const provider = plannerProvider();
  const messages: unknown[] = [
    { role: "system", content: systemPrompt() },
    { role: "user", content: prompt },
  ];
  const results: unknown[] = [];

  for (let round = 0; round < MAX_PLANNER_ROUNDS; round++) {
    const message = await complete(provider, messages);
    // Echo the message untouched: Gemini requires its tool-call thought_signature back.
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
