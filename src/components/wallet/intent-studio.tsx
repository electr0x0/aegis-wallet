"use client";
import { useState } from "react";
import { Expand, Lock, Minimize2, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AgentChat } from "./agent-chat";
import { useWallet } from "./wallet-provider";

// The Aegis shield from src/app/icon.svg on a 24px grid, wearing an agent visor.
const SHIELD =
  "M5 5.3Q5 4 6.3 4H17.7Q19 4 19 5.3V12C19 16.5 16 19.1 12 20.6C8 19.1 5 16.5 5 12Z";
const SHIELD_RIGHT = "M12 4H17.7Q19 4 19 5.3V12C19 16.5 16 19.1 12 20.6Z";

function AgentMark() {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden="true">
      <path d={SHIELD_RIGHT} fill="currentColor" opacity={0.25} />
      <path
        d={SHIELD}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <rect x={8} y={9.5} width={8} height={4} rx={2} fill="currentColor" />
      <circle cx={10.3} cy={11.5} r={0.85} className="fill-background" />
      <circle cx={13.7} cy={11.5} r={0.85} className="fill-background" />
      <path
        d="M12 1.2V2.8M11.2 2H12.8"
        stroke="currentColor"
        strokeWidth={1.2}
        strokeLinecap="round"
      />
    </svg>
  );
}

export function IntentStudio({ onClose }: { onClose?: () => void }) {
  const { accountState, busy, clearThread, messages } = useWallet();
  const [expanded, setExpanded] = useState(false);
  const status =
    accountState.session.status === "LOCKED"
      ? "LOCKED"
      : (accountState.session.tier1 ?? "UNAVAILABLE");
  return (
    <aside
      className="copilot-panel flex h-full min-h-0 shrink-0 flex-col border-l bg-background"
      data-expanded={expanded}
      aria-label="Intent Studio copilot"
    >
      <header className="flex h-14 min-h-14 shrink-0 items-center justify-between gap-1.5 border-b pr-3 pl-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg border bg-primary/10 text-primary">
            <AgentMark />
          </span>
          <div className="min-w-0">
            <h2 className="whitespace-nowrap text-xs font-semibold">
              Intent Studio{" "}
              <span className="text-[10px] font-normal text-muted-foreground max-[760px]:hidden">
                · Autonomous Agent
              </span>
            </h2>
            <span
              className="group flex items-center gap-1.5 font-mono text-[9px] text-muted-foreground data-[active=true]:text-primary"
              data-active={status === "ACTIVE"}
            >
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex size-full rounded-full bg-current opacity-60 group-data-[active=true]:animate-ping motion-reduce:animate-none" />
                <span className="relative inline-flex size-1.5 rounded-full bg-current" />
              </span>
              {status === "LOCKED" ? (
                <Lock size={9} aria-hidden />
              ) : (
                <ShieldCheck size={9} aria-hidden />
              )}
              Session: {status}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="px-2 text-[10px]"
            disabled={busy || !messages.length}
            onClick={clearThread}
          >
            Clear Thread
          </Button>
          {onClose ? (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Close Intent Studio"
              onClick={onClose}
            >
              <X size={15} />
            </Button>
          ) : (
            <Button
              size="icon-sm"
              variant="ghost"
              className="copilot-expand"
              aria-label={
                expanded ? "Restore copilot width" : "Expand copilot width"
              }
              aria-pressed={expanded}
              onClick={() => setExpanded((x) => !x)}
            >
              {expanded ? <Minimize2 size={15} /> : <Expand size={15} />}
            </Button>
          )}
        </div>
      </header>
      <AgentChat key={accountState.activeAccount?.id ?? "locked"} />
    </aside>
  );
}
