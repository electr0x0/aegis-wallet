"use client";

import { useState } from "react";
import {
  ArrowRightLeft,
  ChevronDown,
  Landmark,
  ScanSearch,
  Send,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ConversationMessage,
  ConversationThread,
} from "@/components/godui/conversation-thread";
import {
  PromptSuggestions,
  type PromptSuggestion,
} from "@/components/godui/prompt-suggestions";
import { PromptComposer } from "@/components/godui/prompt-composer";
import { SpotlightCard } from "@/components/godui/spotlight-card";
import { looksLikeInvoice } from "@/lib/agent/invoice";
import { cn } from "@/lib/utils";
import { ApprovalCard } from "./approval-card";
import { AgentReply, describeError, describeResult } from "./agent-reply";
import { TierBadge } from "./console-views";
import { ExecutionSteps } from "./execution-steps";
import { InvoiceInbox } from "./invoice-inbox";
import { InvoiceDocument } from "./invoice-views";
import { buildScenarios } from "./scenarios";
import { useWallet } from "./wallet-provider";
import type { AgentMessage } from "./types";

// A pasted invoice reads as a document, not as a green chat bubble.
const DOCUMENT_BUBBLE = "bg-transparent p-0 text-foreground shadow-none";

function Intent({ text, reading }: { text: string; reading?: boolean }) {
  return looksLikeInvoice(text) ? (
    <InvoiceDocument text={text} reading={reading} />
  ) : (
    text
  );
}

const SCENARIO_ICONS: Record<string, LucideIcon> = {
  portfolio: ScanSearch,
  wrap: ArrowRightLeft,
  vault: Landmark,
  external: Send,
  security: ShieldAlert,
};

function Exchange({ message }: { message: AgentMessage }) {
  const reply =
    message.error === undefined
      ? describeResult(message.result)
      : describeError(message.error);
  return (
    <>
      <ConversationMessage
        role="user"
        timestamp={new Date(message.time).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })}
        contentClassName={
          looksLikeInvoice(message.intent) ? DOCUMENT_BUBBLE : undefined
        }
      >
        <Intent text={message.intent} />
      </ConversationMessage>
      <ConversationMessage role="assistant" name="Aegis" fullWidth>
        <ExecutionSteps steps={message.steps ?? []} />
        <AgentReply reply={reply} raw={message.result} />
      </ConversationMessage>
    </>
  );
}
export function AgentChat() {
  const {
    messages,
    busy,
    authorizing,
    sessionLocked,
    pending,
    snapshot,
    guarded,
    send,
    decide,
    progress,
    activeIntent,
  } = useWallet();
  const [prompt, setPrompt] = useState("");
  const [showScenarios, setShowScenarios] = useState(true);
  const scenarios = buildScenarios(snapshot?.portfolio, snapshot?.policy);
  const suggestions = scenarios.map((scenario) => {
    const Icon = SCENARIO_ICONS[scenario.id];
    return {
      ...scenario,
      icon: <Icon size={13} aria-hidden />,
      badge: <TierBadge tier={scenario.tier} />,
    };
  });
  const vaultReason = scenarios.find((s) => s.id === "vault")?.disabledReason;
  // The scanning beam runs until the reader reports or any later stage starts.
  const reading = !progress.some(
    (step) => step.stage !== "extraction" || step.status !== "running",
  );
  const select = (suggestion: PromptSuggestion) => {
    const scenario = scenarios.find((s) => s.id === suggestion.id);
    if (scenario && !scenario.disabled && !busy && !sessionLocked)
      void send(scenario.prompt);
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ConversationThread
        variant="compact"
        className="agent-thread h-auto min-h-0 flex-1 overscroll-contain"
        aria-live="polite"
        aria-label="Conversation with your agent"
      >
        {!messages.length && !pending.length && !activeIntent && (
          <SpotlightCard
            className="bg-muted/40 p-4 text-sm"
            glowColor="color-mix(in oklch, var(--primary) 8%, transparent)"
          >
            <p className="font-semibold">Your agent, within your mandate.</p>
            <p className="mt-2 text-xs text-muted-foreground">
              Describe an intent or choose a scenario below.
            </p>
            <dl className="flex flex-col gap-2.5 py-4 text-[11px]">
              <div className="grid grid-cols-[90px_1fr] gap-3">
                <dt className="font-medium">Tier 0 · Read</dt>
                <dd className="text-muted-foreground">
                  Inspect balances and gas freely.
                </dd>
              </div>
              <div className="grid grid-cols-[90px_1fr] gap-3">
                <dt className="font-medium">Tier 1 · Auto</dt>
                <dd className="text-muted-foreground">
                  Execute within your saved limits.
                </dd>
              </div>
              <div className="grid grid-cols-[90px_1fr] gap-3">
                <dt className="font-medium">Tier 2 · HITL</dt>
                <dd className="text-muted-foreground">
                  Pause for review, hold and operator PIN.
                </dd>
              </div>
            </dl>
            <p className="text-[11px] text-muted-foreground">
              Scenario tier labels describe the intended flow. Live policy and
              simulation always decide.
            </p>
          </SpotlightCard>
        )}
        {messages.map((message) => (
          <Exchange key={message.id} message={message} />
        ))}
        {activeIntent && (
          <>
            <ConversationMessage
              role="user"
              contentClassName={
                looksLikeInvoice(activeIntent) ? DOCUMENT_BUBBLE : undefined
              }
            >
              <Intent text={activeIntent} reading={reading} />
            </ConversationMessage>
            <ConversationMessage role="assistant" name="Aegis" fullWidth>
              <p className="text-xs text-muted-foreground">
                {authorizing
                  ? "Waiting for operator PIN"
                  : progress.length
                    ? "Live execution events"
                    : "Waiting for server execution events…"}
              </p>
              <ExecutionSteps steps={progress} />
            </ConversationMessage>
          </>
        )}
        {pending.map((proposal) => (
          <ApprovalCard
            key={proposal.id}
            proposal={proposal}
            whitelist={snapshot?.policy.whitelistedAddresses}
            guarded={guarded}
            busy={busy || sessionLocked}
            onDecide={decide}
          />
        ))}
      </ConversationThread>
      <div className="copilot-input shrink-0 border-t bg-muted/40 p-3">
        <Collapsible
          open={showScenarios}
          onOpenChange={setShowScenarios}
          className="mb-2.5"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Demo scenarios
            </span>
            <CollapsibleTrigger asChild>
              <Button
                size="xs"
                variant="ghost"
                className="h-5 text-[10px] text-muted-foreground"
              >
                {showScenarios ? "Hide" : `Show ${scenarios.length}`}
                <ChevronDown
                  aria-hidden
                  className={cn(
                    "transition-transform",
                    !showScenarios && "rotate-180",
                  )}
                />
              </Button>
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent>
            <div className="pt-2">
              <InvoiceInbox
                disabled={busy || sessionLocked}
                onSubmit={(text) => void send(text)}
              />
            </div>
            <fieldset
              disabled={busy || sessionLocked}
              aria-label="Quick scenarios"
              className="min-w-0"
            >
              <PromptSuggestions
                variant="list"
                compact
                suggestions={suggestions}
                onSelect={select}
                className="gap-1"
              />
            </fieldset>
            {vaultReason && (
              <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
                Vault: {vaultReason}
              </p>
            )}
          </CollapsibleContent>
        </Collapsible>
        <PromptComposer
          value={prompt}
          onValueChange={setPrompt}
          onSend={(text) => {
            if (text.trim() && !busy && !sessionLocked) {
              setPrompt("");
              void send(text);
            }
          }}
          disabled={busy || sessionLocked}
          maxLength={4000}
          maxRows={5}
          allowAttachments={false}
          placeholder={
            sessionLocked
              ? "Unlock an account to begin…"
              : "Describe an intent…"
          }
          className="rounded-lg bg-background shadow-none"
        />
        <div className="mt-2 flex justify-between gap-1.5 text-[9px] text-muted-foreground">
          <span>Policy + simulation before signing</span>
          <kbd className="whitespace-nowrap font-mono">Ctrl + Enter</kbd>
        </div>
      </div>
    </div>
  );
}
