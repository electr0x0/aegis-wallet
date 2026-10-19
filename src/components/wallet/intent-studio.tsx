"use client";
import { useState } from "react";
import { Expand, Minimize2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AgentChat } from "./agent-chat";
import { useWallet } from "./wallet-provider";

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
        <div className="min-w-0">
          <h2 className="whitespace-nowrap text-xs font-semibold">
            Intent Studio{" "}
            <span className="text-[10px] font-normal text-muted-foreground max-[760px]:hidden">
              · Autonomous Agent
            </span>
          </h2>
          <span
            className="font-mono text-[9px] text-muted-foreground data-[active=true]:text-primary"
            data-active={status === "ACTIVE"}
          >
            Session: {status}
          </span>
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
