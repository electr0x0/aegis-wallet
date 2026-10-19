"use client";

import { useState } from "react";
import {
  ConversationMessage,
  ConversationThread,
} from "@/components/godui/conversation-thread";
import {
  PromptSuggestions,
  type PromptSuggestion,
} from "@/components/godui/prompt-suggestions";
import { PromptComposer } from "@/components/godui/prompt-composer";
import { ApprovalCard } from "./approval-card";
import { AgentReply, describeError, describeResult } from "./agent-reply";
import { ExecutionSteps } from "./execution-steps";
import { buildScenarios } from "./scenarios";
import { useWallet } from "./wallet-provider";
import type { AgentMessage } from "./types";

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
      >
        {message.intent}
      </ConversationMessage>
      <ConversationMessage role="assistant" name="Aegis">
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
  const scenarios = buildScenarios(snapshot?.portfolio, snapshot?.policy);
  const select = (suggestion: PromptSuggestion) => {
    const scenario = scenarios.find((s) => s.id === suggestion.id);
    if (scenario && !scenario.disabled && !busy && !sessionLocked)
      void send(scenario.prompt);
  };
  return (
    <div className="agent-chat">
      <ConversationThread
        variant="compact"
        className="agent-thread"
        aria-live="polite"
        aria-label="Conversation with your agent"
      >
        {!messages.length && !pending.length && !activeIntent && (
          <div className="copilot-welcome">
            <p className="font-semibold">Your agent, within your mandate.</p>
            <p className="mt-2 text-xs text-muted-foreground">
              Describe an intent or choose a scenario below.
            </p>
            <dl>
              <div>
                <dt>Tier 0 · Read</dt>
                <dd>Inspect balances and gas freely.</dd>
              </div>
              <div>
                <dt>Tier 1 · Auto</dt>
                <dd>Execute within your saved limits.</dd>
              </div>
              <div>
                <dt>Tier 2 · HITL</dt>
                <dd>Pause for review, hold and operator PIN.</dd>
              </div>
            </dl>
            <p className="text-[11px] text-muted-foreground">
              Scenario tier labels describe the intended flow. Live policy and
              simulation always decide.
            </p>
          </div>
        )}
        {messages.map((message) => (
          <Exchange key={message.id} message={message} />
        ))}
        {activeIntent && (
          <>
            <ConversationMessage role="user">
              {activeIntent}
            </ConversationMessage>
            <ConversationMessage role="assistant" name="Aegis">
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
      <div className="copilot-input">
        <fieldset
          disabled={busy || sessionLocked}
          aria-label="Quick scenarios"
          className="min-w-0"
        >
          <PromptSuggestions
            variant="chips"
            suggestions={scenarios}
            onSelect={select}
            className="scenario-chips"
          />
        </fieldset>
        {scenarios.find((s) => s.id === "vault")?.disabledReason && (
          <p className="scenario-help">
            Vault: {scenarios.find((s) => s.id === "vault")?.disabledReason}
          </p>
        )}
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
          className="aegis-composer"
        />
        <div className="composer-caption">
          <span>Policy + simulation before signing</span>
          <kbd>Ctrl + Enter</kbd>
        </div>
      </div>
    </div>
  );
}
