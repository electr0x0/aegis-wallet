"use client";
import { useState } from "react";
import { ArrowRight, Target } from "lucide-react";
import { BentoGrid } from "@/components/godui/bento-grid";
import { AgentStep, AgentTimeline } from "@/components/godui/agent-timeline";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Button } from "@/components/ui/button";
import { ConsoleCard } from "./console-views";
import { useWallet } from "./wallet-provider";
import type { MandateSettings } from "@/lib/treasury/calculate";

export function TreasuryView() {
  const wallet = useWallet();
  const [settings, setSettings] = useState<MandateSettings>({
    maxSweepUsd: "1",
    gasReserveEth: "0.0003",
    asset: "AUTO",
  });
  const [preview, setPreview] = useState<Awaited<
    ReturnType<typeof wallet.previewTreasury>
  > | null>(null);
  const [error, setError] = useState("");
  const disabled = wallet.busy || wallet.sessionLocked;
  const change = (next: MandateSettings) => {
    setSettings(next);
    setPreview(null);
    setError("");
  };
  async function calculate() {
    setError("");
    setPreview(null);
    try {
      setPreview(await wallet.previewTreasury(settings));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Treasury mandates</h1>
        <p className="supporting-copy mt-1">
          Move permitted surplus to your approved vault while preserving gas,
          budget and runway.
        </p>
      </div>
      <BentoGrid
        columns={2}
        className="console-grid auto-rows-auto items-start"
      >
        <ConsoleCard title="Define the financial goal">
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              void calculate();
            }}
          >
            <label className="block space-y-2 text-xs">
              <span>Maximum sweep (reference USD)</span>
              <Input
                value={settings.maxSweepUsd}
                inputMode="decimal"
                required
                disabled={disabled}
                onChange={(e) =>
                  change({ ...settings, maxSweepUsd: e.target.value })
                }
              />
            </label>
            <label className="block space-y-2 text-xs">
              <span>Retain agent gas reserve (ETH)</span>
              <Input
                value={settings.gasReserveEth}
                inputMode="decimal"
                required
                disabled={disabled}
                onChange={(e) =>
                  change({ ...settings, gasReserveEth: e.target.value })
                }
              />
            </label>
            <div className="space-y-2 text-xs">
              <p id="sweep-asset-label">Sweep asset</p>
              <RadioGroup
                aria-labelledby="sweep-asset-label"
                disabled={disabled}
                value={settings.asset}
                onValueChange={(asset) =>
                  change({
                    ...settings,
                    asset: asset as MandateSettings["asset"],
                  })
                }
                className="grid grid-cols-2 gap-2"
              >
                {["AUTO", "USDC", "WETH", "ETH"].map((asset) => (
                  <label
                    key={asset}
                    className="flex items-center gap-2 rounded-md border p-2"
                  >
                    <RadioGroupItem value={asset} />
                    {asset === "AUTO" ? "Automatic" : asset}
                  </label>
                ))}
              </RadioGroup>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Automatic selection prefers USDC, then WETH, then ETH. The saved
              runway floor and single/daily caps always apply. Fiat inputs are
              operator estimates, not bank balances.
            </p>
            <Button disabled={disabled} className="w-full">
              <Target size={15} />
              Calculate live proposal
            </Button>
            {error && (
              <p role="alert" className="break-words text-xs text-destructive">
                {error}
              </p>
            )}
          </form>
        </ConsoleCard>
        <ConsoleCard title="Facts → constraints → one action">
          {!preview ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              Calculate a proposal using live balances. Previewing never signs
              or queues a payment.
            </p>
          ) : (
            <>
              <AgentTimeline aria-label="Treasury calculation">
                <AgentStep
                  title="Live holdings"
                  meta={`$${preview.holdingsUsd}`}
                  status="success"
                  defaultOpen
                >
                  Reference ETH price: ${preview.referenceEthUsd}. Projected fee
                  buffer: {preview.projectedFeeEth} ETH. This buffer is an
                  estimate, not a fee guarantee.
                </AgentStep>
                <AgentStep
                  title="Binding financial constraints"
                  status="success"
                  defaultOpen
                >
                  <dl className="space-y-2">
                    {preview.limits.map((limit) => (
                      <div
                        key={limit.label}
                        className="flex justify-between gap-3"
                      >
                        <dt>{limit.label}</dt>
                        <dd className="font-mono">${limit.usd}</dd>
                      </div>
                    ))}
                  </dl>
                </AgentStep>
                <AgentStep
                  title={
                    preview.action
                      ? "Calculated transfer"
                      : "No eligible surplus"
                  }
                  status="pending"
                  last
                  defaultOpen
                >
                  {preview.action ? (
                    <>
                      <p className="font-medium text-foreground">
                        {preview.action.amount} {preview.action.token}
                      </p>
                      <p className="mt-2 break-all font-mono">
                        {preview.action.recipient}
                      </p>
                      <p className="mt-2">
                        {preview.approvalRequired
                          ? "Your saved policy requires human review and PIN."
                          : "Execution still requires current policy, simulation and guard pre-flight."}
                      </p>
                    </>
                  ) : (
                    <ul className="list-disc space-y-2 pl-4">
                      {preview.reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  )}
                </AgentStep>
              </AgentTimeline>
              {preview.id && (
                <>
                  <p className="mb-3 text-[10px] text-muted-foreground">
                    Single-use preview · expires{" "}
                    {new Date(preview.expiresAt).toLocaleTimeString()}. Any
                    policy change invalidates it. Approvals retain the mandate
                    constraints and expiry.
                  </p>
                  <Button
                    className="w-full"
                    disabled={disabled || Date.now() > preview.expiresAt}
                    onClick={() => {
                      const id = preview.id!;
                      setPreview(null);
                      void wallet.executeTreasury(id);
                    }}
                  >
                    Submit reviewed proposal
                    <ArrowRight size={15} />
                  </Button>
                </>
              )}
            </>
          )}
        </ConsoleCard>
      </BentoGrid>
    </div>
  );
}
