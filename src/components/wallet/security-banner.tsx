"use client";

import { AlertTriangle, X } from "@/components/wallet/icons";
import { Button } from "@/components/ui/button";

export type GuardrailTrip = {
  reason: string;
  // True when an earlier planner step broadcast before the block.
  earlierStepBroadcast: boolean;
};

type Step = {
  decision?: { tier?: string; reasons?: string[] };
  error?: string;
  txHash?: string;
} | null;

const REFUSAL = /\brefus|\bnot supported\b/i;

// A planner result wraps its executions in `results`; a single execution is its own step.
function steps(result: unknown): Step[] {
  if (!result || typeof result !== "object") return [];
  const nested = (result as { results?: unknown }).results;
  return Array.isArray(nested) ? (nested as Step[]) : [result as Step];
}

export function blockedTrip(result: unknown): GuardrailTrip | null {
  const all = steps(result);
  const blocked = all.find((step) => step?.decision?.tier === "BLOCKED");
  if (!blocked) return null;
  const reason =
    blocked.decision?.reasons?.[0] ?? "Blocked by deterministic policy";
  // A failed simulation carries its cause separately, e.g. the balance shortfall.
  const cause =
    blocked.error && blocked.error !== "Blocked before RPC"
      ? blocked.error
      : "";
  return {
    reason: cause ? `${reason}. ${cause}` : reason,
    earlierStepBroadcast: all.some((step) => Boolean(step?.txHash)),
  };
}

export function refusalTrip(message: string): GuardrailTrip | null {
  if (!REFUSAL.test(message)) return null;
  return { reason: message, earlierStepBroadcast: false };
}

export function SecurityBanner({
  trip,
  onDismiss,
}: {
  trip: GuardrailTrip;
  onDismiss: () => void;
}) {
  const outcome = trip.earlierStepBroadcast
    ? "The blocked step was not signed. An earlier step in this plan was broadcast; check Evidence."
    : "No transaction was broadcast. Zero funds moved.";
  return (
    <div
      role="alert"
      className="mt-4 flex items-start gap-3 rounded-xl bg-[var(--red)] p-4 text-white shadow-sm motion-safe:animate-godui-slide-in-from-top"
    >
      <AlertTriangle size={22} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-mono text-xs font-semibold tracking-[0.1em]">
          SECURITY GUARDRAIL TRIGGERED
        </p>
        <p className="mt-1.5 text-sm font-medium [overflow-wrap:anywhere]">
          {trip.reason}
        </p>
        <p className="mt-1 text-[13px] text-white/85">{outcome}</p>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Dismiss security alert"
        className="shrink-0 text-white hover:bg-white/15 hover:text-white focus-visible:ring-white/60"
        onClick={onDismiss}
      >
        <X size={15} />
      </Button>
    </div>
  );
}
