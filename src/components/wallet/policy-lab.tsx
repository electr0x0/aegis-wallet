"use client";
import { useState } from "react";
import { FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { BentoGrid } from "@/components/godui/bento-grid";
import { AgentStep, AgentTimeline } from "@/components/godui/agent-timeline";
import type { PolicyComparison } from "@/lib/agent/tools";
import { ConsoleCard, TierBadge } from "./console-views";
import { useWallet } from "./wallet-provider";

export function PolicyLab() {
  const { snapshot, busy, sessionLocked, comparePolicy } = useWallet();
  const [token, setToken] = useState<"ETH" | "USDC" | "WETH">("USDC");
  const [amount, setAmount] = useState("1");
  const [recipient, setRecipient] = useState(snapshot?.portfolio?.vault ?? "");
  const [single, setSingle] = useState(
    String(snapshot?.policy.tier1SingleTxMaxUsd ?? 2),
  );
  const [daily, setDaily] = useState(
    String(snapshot?.policy.tier1DailyLimitUsd ?? 5),
  );
  const [ask, setAsk] = useState(false);
  const [result, setResult] = useState<PolicyComparison | null>(null);
  const [error, setError] = useState("");
  return (
    <ConsoleCard title="Policy what-if lab · read only">
      <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
        Simulate a transfer and compare the current policy with hypothetical
        spending limits. Blacklists, payee rules, the gas ceiling, pause and
        contract restrictions remain enforced. This lab creates no proposal,
        changes no setting and signs nothing.
      </p>
      <form
        onChange={() => setResult(null)}
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          setResult(null);
          try {
            setResult(
              await comparePolicy(
                {
                  kind: "transfer_token",
                  token,
                  amount,
                  recipient,
                  prompt: `Policy lab: transfer ${amount} ${token} to ${recipient}`,
                },
                {
                  tier1SingleTxMaxUsd: Number(single),
                  tier1DailyLimitUsd: Number(daily),
                  requireApproval: ask,
                },
              ),
            );
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <fieldset disabled={busy || sessionLocked} className="space-y-4">
          <RadioGroup
            value={token}
            onValueChange={(v) => {
              setToken(v as typeof token);
              setResult(null);
            }}
            className="flex flex-wrap gap-4"
            aria-label="Lab asset"
          >
            {["USDC", "WETH", "ETH"].map((t) => (
              <label key={t} className="flex items-center gap-2 text-xs">
                <RadioGroupItem value={t} />
                {t}
              </label>
            ))}
          </RadioGroup>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-2 text-xs">
              <span>Transfer amount</span>
              <Input
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                maxLength={40}
                inputMode="decimal"
              />
            </label>
            <label className="space-y-2 text-xs">
              <span>Recipient address</span>
              <Input
                required
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="0x…"
                maxLength={42}
              />
            </label>
            <label className="space-y-2 text-xs">
              <span>What-if single limit (USD)</span>
              <Input
                required
                type="number"
                min="0"
                max="10000"
                step="0.01"
                value={single}
                onChange={(e) => setSingle(e.target.value)}
              />
            </label>
            <label className="space-y-2 text-xs">
              <span>What-if daily limit (USD)</span>
              <Input
                required
                type="number"
                min="0"
                max="10000"
                step="0.01"
                value={daily}
                onChange={(e) => setDaily(e.target.value)}
              />
            </label>
          </div>
          <label className="flex items-center justify-between gap-3 text-xs">
            What-if always ask before signing
            <Switch
              checked={ask}
              onCheckedChange={(v) => {
                setAsk(v);
                setResult(null);
              }}
            />
          </label>
          <Button type="submit" variant="outline">
            <FlaskConical size={14} />
            Compare with real simulation
          </Button>
        </fieldset>
      </form>
      {error && (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {error}
        </p>
      )}
      {result && (
        <div className="mt-4 space-y-3" aria-live="polite">
          <BentoGrid columns={2} className="console-grid auto-rows-auto">
            {(["current", "hypothetical"] as const).map((key) => (
              <ConsoleCard
                key={key}
                title={
                  key === "current"
                    ? "Current stored policy"
                    : "Hypothetical limits"
                }
                action={<TierBadge tier={result[key].decision.tier} />}
              >
                <p className="text-xs leading-relaxed">
                  {result[key].rationale}
                </p>
              </ConsoleCard>
            ))}
          </BentoGrid>
          <AgentTimeline>
            <AgentStep
              title={
                result.simulation === "PASSED"
                  ? "EVM pre-flight passed"
                  : "Pre-flight or hard policy check failed"
              }
              status={result.simulation === "PASSED" ? "success" : "error"}
              meta={
                result.simulation === "PASSED"
                  ? `Estimated ${result.gasEstimate} gas units. No transaction sent.`
                  : result.simulation
              }
            />
          </AgentTimeline>
          <p className="text-[10px] text-muted-foreground [overflow-wrap:anywhere]">
            Policy {result.policyHash} ·{" "}
            {new Date(result.comparedAt).toLocaleTimeString()}. Results describe
            this snapshot. Execution would recheck all limits and chain state.
          </p>
        </div>
      )}
    </ConsoleCard>
  );
}
