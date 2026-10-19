"use client";

import {
  AlertTriangle,
  LockKeyhole,
  ShieldCheck,
} from "@/components/wallet/icons";
import type { Entry, LedgerVerification } from "@/lib/store";
import { shortAddress } from "./types";

export function VerificationBadge({
  verification,
}: {
  verification?: LedgerVerification;
}) {
  if (!verification) return null;
  if (verification.valid) {
    return (
      <p className="mb-4 flex items-center gap-2 rounded-lg border border-[var(--emerald-line)] bg-[var(--emerald-tint)] px-3 py-2 font-mono text-[11px] font-medium text-[var(--emerald-strong)]">
        <ShieldCheck size={14} className="shrink-0" />
        Ledger verified · {verification.sealed} sealed
      </p>
    );
  }
  const where = verification.brokenAt ? ` at ${verification.brokenAt}` : "";
  return (
    <div className="mb-4 flex items-start gap-2 rounded-lg border border-[var(--red-line)] bg-[var(--red-tint)] px-3 py-2 font-mono text-[11px] font-medium text-[var(--red)]">
      <AlertTriangle size={14} className="mt-px shrink-0" />
      <div className="min-w-0 [overflow-wrap:anywhere]">
        <p>Ledger integrity broken{where}</p>
        {verification.reason && (
          <p className="mt-1 font-sans font-normal">{verification.reason}</p>
        )}
      </div>
    </div>
  );
}

export function SealBadge({ entry }: { entry: Entry }) {
  if (!entry.signature) return null;
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10.5px] text-muted-foreground">
      <span className="inline-flex items-center gap-1 rounded-md border border-[var(--emerald-line)] bg-[var(--emerald-tint)] px-1.5 py-0.5 font-semibold tracking-[0.06em] text-[var(--emerald-strong)]">
        <LockKeyhole size={11} /> SEALED
      </span>
      {entry.hash && (
        <span title={entry.hash}>hash {shortAddress(entry.hash)}</span>
      )}
      {entry.signer && (
        <span title={entry.signer}>signer {shortAddress(entry.signer)}</span>
      )}
    </p>
  );
}
