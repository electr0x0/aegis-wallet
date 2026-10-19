"use client";

import { useState } from "react";
import {
  AlertTriangle,
  LockKeyhole,
  ShieldCheck,
  ArrowUpRight,
} from "@/components/wallet/icons";
import { HoldConfirmButton } from "@/components/godui/hold-confirm-button";
import { SpotlightCard } from "@/components/godui/spotlight-card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { formatUsd, type ProposalView } from "./types";

type FactsProps = {
  proposal: ProposalView;
  whitelist?: string[];
  guarded: boolean;
};

function RecipientStatus({
  recipient,
  whitelist,
}: {
  recipient: string;
  whitelist?: string[];
}) {
  if (!whitelist) return null;
  const known = whitelist.some(
    (address) => address.toLowerCase() === recipient.toLowerCase(),
  );
  if (known) {
    return (
      <span className="mt-1.5 flex items-center gap-1.5 text-xs text-[var(--emerald)]">
        <ShieldCheck size={13} /> Whitelisted recipient
      </span>
    );
  }
  return (
    <span className="mt-1.5 flex items-center gap-1.5 text-xs text-[var(--amber)]">
      <AlertTriangle size={13} /> Unknown recipient: not on the whitelist
    </span>
  );
}

function signingNote(guarded: boolean) {
  return guarded
    ? "Approval is signed by the owner key and verified on-chain by AgentGuard."
    : "Approval executes with the server-held agent key.";
}

// Shared by the card and the review dialog so both show the same evidence.
function ProposalFacts({ proposal, whitelist, guarded }: FactsProps) {
  const { action, decision } = proposal;
  return (
    <dl className="grid min-w-0 gap-3 text-xs [&_dt]:mb-1 [&_dt]:text-[10px] [&_dt]:text-muted-foreground [&_dd]:[overflow-wrap:anywhere]">
      <div>
        <dt>Amount</dt>
        <dd>
          {action.amount} {action.token}{" "}
          <span className="text-muted-foreground">
            · {formatUsd(proposal.usd)} reference value
          </span>
        </dd>
      </div>
      <div>
        <dt>Recipient</dt>
        <dd>
          <span className="block break-all font-mono text-xs">
            {action.recipient}
          </span>
          <RecipientStatus recipient={action.recipient} whitelist={whitelist} />
        </dd>
      </div>
      <div>
        <dt>Pre-flight</dt>
        <dd className="flex items-center gap-1.5">
          <ShieldCheck size={14} className="shrink-0 text-[var(--emerald)]" />
          Simulation passed · {proposal.gasEstimate} gas units
        </dd>
      </div>
      <div>
        <dt>Policy reasons</dt>
        <dd>
          <ul className="list-disc space-y-1 pl-4 text-[11px] leading-relaxed">
            {decision.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </dd>
      </div>
      {decision.runwayMonths !== undefined && (
        <div>
          <dt>Reserve runway</dt>
          <dd>
            {(Math.floor(decision.runwayMonths * 10) / 10).toFixed(1)} months
            after this transfer
          </dd>
        </div>
      )}
      {proposal.rationale && (
        <div>
          <dt>Deterministic rationale</dt>
          <dd className="text-xs leading-relaxed">{proposal.rationale}</dd>
        </div>
      )}
      <div>
        <dt>Signing</dt>
        <dd className="flex items-start gap-1.5 text-xs">
          <LockKeyhole size={13} className="mt-0.5 shrink-0" />
          {signingNote(guarded)}
        </dd>
      </div>
    </dl>
  );
}

export function ApprovalCard({
  proposal,
  whitelist,
  guarded = false,
  busy,
  onDecide,
}: {
  proposal: ProposalView;
  whitelist?: string[];
  guarded?: boolean;
  busy: boolean;
  onDecide: (id: string, approve: boolean) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const approve = () => {
    setOpen(false);
    void onDecide(proposal.id, true);
  };
  const facts = (
    <ProposalFacts
      proposal={proposal}
      whitelist={whitelist}
      guarded={guarded}
    />
  );
  return (
    <SpotlightCard
      className="approval-card rounded-lg border-[var(--amber-line)] bg-[var(--amber-tint)] p-3.5 [&+.approval-card]:mt-3"
      glowColor="rgba(168, 93, 10, .06)"
    >
      <div className="section-label">
        <LockKeyhole size={14} /> HUMAN AUTHORIZATION{" "}
        <span className="ml-auto">TIER 02</span>
      </div>
      <h3 className="my-4 text-2xl font-medium">
        {proposal.action.amount}{" "}
        <span className="text-muted-foreground">{proposal.action.token}</span>
      </h3>
      {facts}
      <div className="mt-4 flex flex-wrap gap-2">
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogTrigger asChild>
            <Button disabled={busy} size="sm">
              Review & approve <ArrowUpRight size={14} />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent className="max-h-[90vh] overflow-y-auto">
            <AlertDialogHeader>
              <AlertDialogTitle>
                Authorize this Base Sepolia transaction
              </AlertDialogTitle>
              <AlertDialogDescription>
                Confirm the amount and destination. Your agent will re-run
                policy checks and simulation before signing.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {facts}
            <p
              id={`hold-help-${proposal.id}`}
              className="text-xs text-muted-foreground"
            >
              Hold the button or press and hold Space / Enter for one second.
              Release early to cancel.
            </p>
            <AlertDialogFooter className="flex-wrap">
              <AlertDialogCancel disabled={busy}>Go back</AlertDialogCancel>
              <HoldConfirmButton
                variant="default"
                size="sm"
                duration={1000}
                disabled={busy}
                aria-describedby={`hold-help-${proposal.id}`}
                onConfirm={approve}
                holdingLabel="Keep holding…"
                confirmedLabel="Authorization sent"
              >
                Approve & broadcast
              </HoldConfirmButton>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void onDecide(proposal.id, false)}
        >
          Reject
        </Button>
      </div>
    </SpotlightCard>
  );
}
