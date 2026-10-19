"use client";
import { Pause, Play, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWallet } from "./wallet-provider";

export function ExecutionControl() {
  const { snapshot, busy, sessionLocked, savePolicy } = useWallet();
  if (!snapshot) return null;
  const paused = Boolean(snapshot.policy.executionPaused);
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-3">
      <div className="flex items-center gap-2 text-xs">
        <ShieldAlert
          size={16}
          className={paused ? "text-destructive" : "text-primary"}
        />
        <div>
          <p className="font-medium">
            {paused ? "Local execution paused" : "Operator execution control"}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            PIN required. Stops this server's writes; it does not revoke the
            on-chain session key.
          </p>
        </div>
      </div>
      <Button
        size="sm"
        variant={paused ? "outline" : "destructive"}
        disabled={busy || sessionLocked}
        onClick={() =>
          void savePolicy({ ...snapshot.policy, executionPaused: !paused })
        }
      >
        {paused ? <Play size={14} /> : <Pause size={14} />}
        {paused ? "Resume local execution" : "Pause local execution"}
      </Button>
    </div>
  );
}
