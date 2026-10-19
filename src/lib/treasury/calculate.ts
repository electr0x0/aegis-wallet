import { formatUnits, isAddress, parseUnits } from "viem";
import { z } from "zod";
import type { Action, Policy } from "../security/policyEngine";

const decimal = /^\d+(?:\.\d{1,6})?$/;
const ethDecimal = /^\d+(?:\.\d{1,18})?$/;
export const mandateSchema = z.object({
  maxSweepUsd: z
    .string()
    .max(40)
    .regex(decimal)
    .refine(
      (v) =>
        decimal.test(v) &&
        v.length <= 40 &&
        parseUnits(v, 6) > 0n &&
        parseUnits(v, 6) <= 10_000_000000n,
    ),
  gasReserveEth: z
    .string()
    .max(40)
    .regex(ethDecimal)
    .refine(
      (v) =>
        ethDecimal.test(v) &&
        v.length <= 40 &&
        parseUnits(v, 18) >= parseUnits("0.00001", 18) &&
        parseUnits(v, 18) <= parseUnits("1", 18),
    ),
  asset: z.enum(["AUTO", "USDC", "WETH", "ETH"]),
});
export type MandateSettings = z.infer<typeof mandateSchema>;
export type TreasuryConstraint = {
  settings: MandateSettings;
  policyHash: string;
  expiresAt: number;
};
export type TreasuryFacts = {
  balances: Record<string, string>;
  agentGasEth?: string;
  mode?: "guard" | "eoa";
  vault: string | null;
  gasGwei: number;
};
export type SpendEntry = {
  accountId?: string;
  id: string;
  operationId?: string;
  timestamp: string;
  tier: string;
  status: string;
  usd: number;
};
const USD_SCALE = 1_000000n;
const WEI = 10n ** 18n;
const ETH_PRICE = 2500n * USD_SCALE;

// Interpret legacy numeric USD policy inputs as decimal strings. New arithmetic is bigint.
// Caps round down; liabilities and consumed budget round up.
export function decimalUnits(
  value: string | number,
  decimals: number,
  ceil = false,
): bigint {
  const match = String(value).match(/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if (!match) throw new Error("A non-negative finite decimal is required");
  const fraction = match[2] ?? "";
  const shift = decimals + Number(match[3] ?? 0) - fraction.length;
  if (Math.abs(shift) > 100) throw new Error("Decimal scale exceeds bounds");
  const digits = BigInt(match[1] + fraction);
  if (shift >= 0) return digits * 10n ** BigInt(shift);
  const divisor = 10n ** BigInt(-shift);
  return digits / divisor + (ceil && digits % divisor ? 1n : 0n);
}
export function spentUnits(
  logs: SpendEntry[],
  accountId: string,
  now = Date.now(),
) {
  const latest = new Map<string, SpendEntry>();
  for (const entry of logs)
    if ((entry.accountId ?? "master") === accountId)
      latest.set(entry.operationId ?? entry.id, entry);
  let spent = 0n;
  for (const e of latest.values()) {
    if (
      e.tier === "TIER_1_AUTO" &&
      ["CONFIRMED", "SUBMITTED", "BROADCASTING"].includes(e.status) &&
      now - Date.parse(e.timestamp) < 86_400_000
    )
      spent += decimalUnits(e.usd, 6, true);
  }
  return spent;
}
const minimum = (...values: bigint[]) =>
  values.reduce((a, b) => (a < b ? a : b));
const positive = (value: bigint) => (value > 0n ? value : 0n);
const asUsd = (value: bigint) => formatUnits(value, 6);

export function calculateSweep(
  settings: MandateSettings,
  live: TreasuryFacts,
  policy: Policy,
  spent: bigint,
) {
  const held = {
    USDC: parseUnits(live.balances.USDC ?? "0", 6),
    WETH: parseUnits(live.balances.WETH ?? "0", 18),
    ETH: parseUnits(live.balances.ETH ?? "0", 18),
  };
  const holdings = held.USDC + ((held.ETH + held.WETH) * ETH_PRICE) / WEI;
  const reserve = parseUnits(settings.gasReserveEth, 18);
  // Conservative projection at 2× observed gas and 300k units. Not a fee guarantee.
  const fee = decimalUnits(live.gasGwei, 9, true) * 600_000n;
  const agentGas =
    live.agentGasEth !== undefined
      ? parseUnits(live.agentGasEth, 18)
      : live.mode === "guard"
        ? null
        : held.ETH;
  const single = decimalUnits(policy.tier1SingleTxMaxUsd, 6);
  const daily = positive(decimalUnits(policy.tier1DailyLimitUsd, 6) - spent);
  const requested = parseUnits(settings.maxSweepUsd, 6);
  const treasury = policy.treasury;
  const runwayReserve = treasury
    ? (decimalUnits(treasury.monthlyExpensesUsd, 6, true) *
        decimalUnits(treasury.minRunwayMonths, 6, true) +
        USD_SCALE -
        1n) /
      USD_SCALE
    : 0n;
  const runwaySurplus = treasury
    ? positive(
        decimalUnits(treasury.fiatReserveUsd, 6) +
          holdings -
          runwayReserve -
          (fee * ETH_PRICE) / WEI,
      )
    : holdings;
  const cap = minimum(requested, single, daily, runwaySurplus);
  const limits = [
    { label: "Requested sweep ceiling", usd: asUsd(requested) },
    { label: "Tier 1 single-transaction cap", usd: asUsd(single) },
    { label: "Remaining rolling budget", usd: asUsd(daily) },
    { label: "Surplus above runway floor", usd: asUsd(runwaySurplus) },
  ];
  const reasons: string[] = [];
  const vault = live.vault;
  if (policy.executionPaused) reasons.push("Local execution is paused.");
  if (
    !vault ||
    !isAddress(vault) ||
    !policy.whitelistedAddresses.some(
      (a) => a.toLowerCase() === vault.toLowerCase(),
    )
  )
    reasons.push("Configure a whitelisted savings vault first.");
  if (
    vault &&
    policy.blacklistedAddresses.some(
      (a) => a.toLowerCase() === vault.toLowerCase(),
    )
  )
    reasons.push("The vault is blacklisted.");
  if (agentGas === null || agentGas < reserve + fee)
    reasons.push(
      "The agent gas balance cannot preserve the requested reserve and projected fee buffer.",
    );
  if (cap <= 0n)
    reasons.push(
      "No spendable surplus remains within the requested cap, daily budget and runway floor.",
    );
  if (live.gasGwei > policy.maxGasGwei)
    reasons.push("Observed gas exceeds the configured ceiling.");
  let action: Action | null = null;
  if (!reasons.length && vault) {
    const order =
      settings.asset === "AUTO"
        ? (["USDC", "WETH", "ETH"] as const)
        : [settings.asset];
    for (const token of order) {
      const available =
        token === "ETH" && live.mode !== "guard"
          ? positive(held.ETH - reserve - fee)
          : held[token];
      const amount = minimum(
        available,
        token === "USDC" ? cap : (cap * WEI) / ETH_PRICE,
      );
      const usd = token === "USDC" ? amount : (amount * ETH_PRICE) / WEI;
      if (amount <= 0n || usd <= 0n) continue;
      const text = formatUnits(amount, token === "USDC" ? 6 : 18);
      action = {
        kind: "transfer_token",
        token,
        amount: text,
        recipient: vault,
        prompt: `Treasury mandate: send ${text} ${token} to ${vault}. Preserve ${settings.gasReserveEth} ETH agent gas and the saved runway floor; maximum sweep ${settings.maxSweepUsd} USD reference value.`,
      };
      break;
    }
    if (!action)
      reasons.push(
        "The selected asset has no transferable balance above the reserve.",
      );
  }
  return {
    action,
    reasons,
    limits,
    holdingsUsd: asUsd(holdings),
    projectedFeeEth: formatUnits(fee, 18),
    gasReserveEth: settings.gasReserveEth,
    approvalRequired: Boolean(policy.requireApproval),
    referenceEthUsd: "2500",
    calculatedAt: new Date().toISOString(),
  };
}
export type SweepCalculation = ReturnType<typeof calculateSweep>;
