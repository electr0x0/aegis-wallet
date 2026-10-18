"use client";

import { useState } from "react";
import {
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
import type { Proposal } from "@/lib/store";

export function ApprovalCard({
  proposal,
  busy,
  onDecide,
}: {
  proposal: Proposal;
  busy: boolean;
  onDecide: (id: string, approve: boolean) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const approve = () => {
    setOpen(false);
    void onDecide(proposal.id, true);
  };
  return (
    <SpotlightCard
      className="approval-card"
      glowColor="rgba(231, 190, 117, .08)"
    >
      <div className="section-label text-amber-200">
        <LockKeyhole size={14} /> HUMAN AUTHORIZATION{" "}
        <span className="ml-auto">TIER 02</span>
      </div>
      <h3 className="mt-4 text-2xl font-medium">
        {proposal.action.amount}{" "}
        <span className="text-muted-foreground">{proposal.action.token}</span>
      </h3>
      <p className="my-3 break-all font-mono text-xs text-muted-foreground">
        {proposal.action.recipient}
      </p>
      <p className="text-xs text-amber-100/80">
        {proposal.decision.reasons.join(" · ")}
      </p>
      <div className="my-4 flex items-center gap-2 text-xs text-muted-foreground">
        <ShieldCheck size={14} /> Simulation passed · {proposal.gasEstimate} gas
        units
      </div>
      <div className="flex flex-wrap gap-2">
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogTrigger asChild>
            <Button disabled={busy} size="sm">
              Review & approve <ArrowUpRight size={14} />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Authorize this Base Sepolia transaction
              </AlertDialogTitle>
              <AlertDialogDescription>
                Confirm the amount and destination. Your agent will re-run
                policy checks and simulation before signing.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <dl className="approval-details">
              <div>
                <dt>Amount</dt>
                <dd>
                  {proposal.action.amount} {proposal.action.token}
                </dd>
              </div>
              <div>
                <dt>Recipient</dt>
                <dd className="break-all font-mono text-xs">
                  {proposal.action.recipient}
                </dd>
              </div>
              <div>
                <dt>Estimated gas</dt>
                <dd>{proposal.gasEstimate} units</dd>
              </div>
              <div>
                <dt>Approval reason</dt>
                <dd>{proposal.decision.reasons.join("; ")}</dd>
              </div>
            </dl>
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
