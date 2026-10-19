import { randomUUID } from "node:crypto";
import { currentAccountId } from "../auth/context";
import { portfolio, publicClient } from "../chain";
import { ledger, policy, policyHash } from "../store";
import { executeAction } from "../agent/tools";
import {
  calculateSweep,
  mandateSchema,
  spentUnits,
  type TreasuryConstraint,
} from "./calculate";

type Quote = {
  accountId: string;
  constraint: TreasuryConstraint;
  action: NonNullable<ReturnType<typeof calculateSweep>["action"]>;
};
// Request-scoped execution uses stored quotes, never action fields supplied by a browser.
const state = globalThis as typeof globalThis & {
  aegisMandateQuotes?: Map<string, Quote>;
};
const quotes = (state.aegisMandateQuotes ??= new Map());
export async function previewMandate(input: unknown) {
  const settings = mandateSchema.parse(input);
  if ((await publicClient.getChainId()) !== 84532)
    throw new Error("Base Sepolia chain 84532 required");
  const [live, p, l] = await Promise.all([portfolio(), policy(), ledger()]);
  const calculation = calculateSweep(
    settings,
    live,
    p,
    spentUnits(l.logs, currentAccountId()),
  );
  const expiresAt = Date.now() + 5 * 60_000;
  for (const [id, q] of quotes)
    if (q.constraint.expiresAt < Date.now()) quotes.delete(id);
  if (quotes.size >= 200)
    throw new Error("Too many outstanding previews; wait for expiry");
  const id = calculation.action ? randomUUID() : null;
  const hash = policyHash(p);
  if (id && calculation.action)
    quotes.set(id, {
      accountId: currentAccountId(),
      action: calculation.action,
      constraint: {
        settings: { ...settings, asset: calculation.action.token },
        policyHash: hash,
        expiresAt,
      },
    });
  return {
    ...calculation,
    id,
    expiresAt,
    policyHash: hash,
    accountId: currentAccountId(),
  };
}
export async function executeMandate(id: string) {
  const quote = quotes.get(id);
  if (!quote || quote.accountId !== currentAccountId())
    throw new Error(
      "Preview missing or belongs to another account. Preview again.",
    );
  if (Date.now() > quote.constraint.expiresAt) {
    quotes.delete(id);
    throw new Error("Preview expired. Preview again.");
  }
  // Consume before any await: a duplicate request cannot reuse a quote, even on RPC failure.
  quotes.delete(id);
  return executeAction(
    quote.action,
    false,
    undefined,
    undefined,
    false,
    quote.constraint,
  );
}
