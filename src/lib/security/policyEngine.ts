// Pure, deterministic policy gate. No I/O: every input arrives as an argument.

// Operator-entered fiat profile. Not a live bank feed.
export type Treasury = {
  fiatReserveUsd: number;
  monthlyExpensesUsd: number;
  minRunwayMonths: number;
};

export type Policy = {
  tier1SingleTxMaxUsd: number;
  tier1DailyLimitUsd: number;
  maxGasGwei: number;
  whitelistedAddresses: string[];
  blacklistedAddresses: string[];
  requireApproval: boolean;
  treasury?: Treasury;
};

export type Action = {
  kind: "read" | "wrap_eth" | "unwrap_weth" | "transfer_token" | "fund_account";
  token: "ETH" | "WETH" | "USDC";
  amount: string;
  recipient: string;
  prompt: string;
};

export type Tier = "TIER_0" | "TIER_1_AUTO" | "TIER_2_HITL" | "BLOCKED";

export type Decision = {
  tier: Tier;
  reasons: string[];
  riskScore: number;
  runwayMonths?: number;
};

export type PolicyContext = {
  spentUsd: number;
  usd: number;
  gasGwei: number;
  simulation: boolean;
  holdingsUsd?: number;
  onboardingRecipient?: string;
};

export const ADVERSARIAL =
  /ignore (all|previous)|drain wallet|override|system prompt|developer mode/i;

function listed(list: string[], address: string): boolean {
  return list.some((x) => x.toLowerCase() === address.toLowerCase());
}

function block(reason: string): Decision {
  return { tier: "BLOCKED", reasons: [reason], riskScore: 100 };
}

// Truncated, never rounded up, so a breach can't display as "3.0 months (floor 3)".
function months(value: number): string {
  return (Math.floor(value * 10) / 10).toFixed(1);
}

// Months of expenses left after this outflow, or undefined when not computable.
function runwayAfter(
  action: Action,
  policy: Policy,
  context: PolicyContext,
): number | undefined {
  const treasury = policy.treasury;
  if (!["transfer_token", "fund_account"].includes(action.kind) || !treasury)
    return undefined;
  const holdings = context.holdingsUsd;
  if (holdings === undefined || !Number.isFinite(holdings)) return undefined;
  if (!(treasury.monthlyExpensesUsd > 0)) return undefined;
  const remaining = treasury.fiatReserveUsd + holdings - context.usd;
  return remaining / treasury.monthlyExpensesUsd;
}

export function evaluateTransactionPolicy(
  action: Action,
  policy: Policy,
  context: PolicyContext,
): Decision {
  // Hard blocks first. Human approval cannot override any of these.
  if (listed(policy.blacklistedAddresses, action.recipient)) {
    return block("Blacklisted recipient");
  }
  const onboarding = action.kind === "fund_account";
  if (
    onboarding &&
    (action.token !== "ETH" ||
      action.amount !== "0.0003" ||
      context.onboardingRecipient?.toLowerCase() !==
        action.recipient.toLowerCase())
  ) {
    return block("Invalid or unreserved onboarding drip");
  }
  const trusted =
    listed(policy.whitelistedAddresses, action.recipient) || onboarding;
  if (ADVERSARIAL.test(action.prompt) && !trusted) {
    return block("Adversarial instruction with unverified recipient");
  }
  if (action.kind === "read") {
    return { tier: "TIER_0", reasons: ["Read-only operation"], riskScore: 0 };
  }
  if (!Number.isFinite(context.usd) || context.usd <= 0) {
    return block("Invalid transaction value");
  }
  if (!context.simulation) return block("Pre-flight simulation failed");
  if (
    !Number.isFinite(context.gasGwei) ||
    context.gasGwei > policy.maxGasGwei
  ) {
    return block("Gas exceeds configured ceiling");
  }

  // Soft limits: any one of these routes the action to a human.
  const reasons: string[] = [];
  if (!trusted) reasons.push("Recipient is not whitelisted");
  if (context.usd > policy.tier1SingleTxMaxUsd) {
    reasons.push("Single transaction limit exceeded");
  }
  if (context.spentUsd + context.usd > policy.tier1DailyLimitUsd) {
    reasons.push("Rolling 24-hour autonomous limit exceeded");
  }
  const runway = runwayAfter(action, policy, context);
  const floor = policy.treasury?.minRunwayMonths ?? 0;
  if (runway !== undefined && runway < floor) {
    reasons.push(
      `Reserve runway would fall to ${months(runway)} months (floor ${floor} months)`,
    );
  }
  if (policy.requireApproval) reasons.push("Human confirmation enabled");

  const decision: Decision = reasons.length
    ? { tier: "TIER_2_HITL", reasons, riskScore: 65 }
    : {
        tier: "TIER_1_AUTO",
        reasons: ["Within autonomous permission bounds"],
        riskScore: 10,
      };
  if (runway !== undefined) decision.runwayMonths = runway;
  return decision;
}

export type ExplainContext = {
  usd: number;
  spentUsd: number;
  policy: Policy;
  simulation: boolean;
};

function dollars(value: number): string {
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

function trimAmount(amount: string): string {
  if (!amount.includes(".")) return amount;
  return amount.replace(/0+$/, "").replace(/\.$/, "");
}

function summarize(action: Action, usd: number): string {
  const amount = `${trimAmount(action.amount)} ${action.token}`;
  const value = Number.isFinite(usd) ? ` (~${dollars(usd)})` : "";
  if (action.kind === "read") return "read-only request";
  if (action.kind === "wrap_eth") return `wrap ${amount}${value}`;
  if (action.kind === "unwrap_weth") return `unwrap ${amount}${value}`;
  return `transfer ${amount} to ${action.recipient}${value}`;
}

function runwaySentence(decision: Decision, policy: Policy): string {
  if (decision.runwayMonths === undefined || !policy.treasury) return "";
  const floor = policy.treasury.minRunwayMonths;
  // A breach is already named in the reasons.
  if (decision.runwayMonths < floor) return "";
  return ` Reserve runway ${months(decision.runwayMonths)} months (floor ${floor}).`;
}

// Deterministic, human-readable audit rationale. Never produced by a model.
export function explainDecision(
  action: Action,
  decision: Decision,
  ctx: ExplainContext,
): string {
  const head = `${decision.tier}: ${summarize(action, ctx.usd)}.`;
  const simulation = ctx.simulation
    ? " Pre-flight simulation passed."
    : " Pre-flight simulation failed.";
  const runway = runwaySentence(decision, ctx.policy);
  const reasons = decision.reasons.join("; ");

  if (decision.tier === "TIER_0") return `${head} No signing.`;
  if (decision.tier === "BLOCKED") {
    return `${head} Blocked: ${reasons}. Nothing was signed.`;
  }
  if (decision.tier === "TIER_2_HITL") {
    return `${head} Held for human approval: ${reasons}.${simulation}${runway}`;
  }
  const cap = dollars(ctx.policy.tier1SingleTxMaxUsd);
  const used = dollars(ctx.spentUsd + ctx.usd);
  const budget = dollars(ctx.policy.tier1DailyLimitUsd);
  return (
    `${head} Within ${cap} single-transaction cap; ` +
    `${used} of ${budget} rolling 24h autonomous budget used.` +
    `${simulation}${runway}`
  );
}
