"use client";
import { useEffect, useState } from "react";
import { Check, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import type { Policy } from "@/lib/security/policyEngine";
export function PolicyControls({
  policy,
  busy,
  save,
}: {
  policy: Policy | null;
  busy: boolean;
  save: (policy: Policy) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Policy | null>(policy);
  useEffect(() => {
    setDraft((current) => current || policy);
  }, [policy]);
  if (!draft)
    return (
      <div className="telemetry-body space-y-6">
        <Skeleton className="h-6 w-36" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  const controls = [
    {
      key: "tier1SingleTxMaxUsd",
      label: "Single transaction cap",
      unit: "USD",
      max: 20,
      step: 0.1,
      help: "Above this value, your agent requests approval.",
    },
    {
      key: "tier1DailyLimitUsd",
      label: "Rolling 24-hour budget",
      unit: "USD",
      max: 50,
      step: 0.5,
      help: "Includes submitted and unresolved autonomous transactions.",
    },
    {
      key: "maxGasGwei",
      label: "Gas price ceiling",
      unit: "GWEI",
      max: 100,
      step: 1,
      help: "Transactions above this gas price are blocked.",
    },
  ] as const;
  return (
    <form
      className="policy-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save(draft);
      }}
    >
      <h2 className="text-sm font-medium">Permission guardrails</h2>
      <p className="supporting-copy mt-2">
        Your rules, enforced before every broadcast.
      </p>
      <fieldset disabled={busy} className="policy-fields">
        {controls.map((control) => (
          <div key={control.key}>
            <div className="flex items-center justify-between gap-4">
              <label htmlFor={control.key} className="text-xs font-medium">
                {control.label}
              </label>
              <div className="flex items-center gap-2">
                <Input
                  id={control.key}
                  type="number"
                  min={control.key === "maxGasGwei" ? 0.01 : 0}
                  max={control.key === "maxGasGwei" ? 1000 : 10000}
                  step="0.01"
                  required
                  value={draft[control.key]}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      [control.key]: Number(event.target.value),
                    })
                  }
                  className="h-8 w-20 text-right font-mono text-xs"
                />
                <span className="unit-label">{control.unit}</span>
              </div>
            </div>
            <Slider
              disabled={busy}
              aria-label={`${control.label} slider`}
              min={control.key === "maxGasGwei" ? 1 : 0}
              max={Math.max(control.max, draft[control.key])}
              step={control.step}
              value={[draft[control.key]]}
              onValueChange={([value]) =>
                setDraft({ ...draft, [control.key]: value })
              }
              className="my-4"
            />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {control.help}
            </p>
          </div>
        ))}
        {(
          [
            ["whitelistedAddresses", "Whitelisted addresses"],
            ["blacklistedAddresses", "Blacklisted addresses"],
          ] as const
        ).map(([key, label]) => (
          <div key={key}>
            <label htmlFor={key} className="text-xs font-medium">
              {label}
            </label>
            <Textarea
              id={key}
              rows={5}
              value={draft[key].join("\n")}
              onChange={(e) =>
                setDraft({ ...draft, [key]: e.target.value.split("\n") })
              }
              className="mt-3 min-h-28 font-mono text-[11px]"
            />
            <p className="mt-2 text-[11px] text-muted-foreground">
              One complete address per line.
              {key === "blacklistedAddresses"
                ? " Blacklist takes precedence over the whitelist."
                : ""}
            </p>
          </div>
        ))}
        <div className="confirmation-setting">
          <div>
            <label htmlFor="human-confirmation" className="text-xs font-medium">
              Always ask before signing
            </label>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Require human approval for every write.
            </p>
          </div>
          <Switch
            disabled={busy}
            id="human-confirmation"
            checked={draft.requireApproval}
            onCheckedChange={(checked) =>
              setDraft({ ...draft, requireApproval: checked })
            }
          />
        </div>
        <Button type="submit" disabled={busy} className="w-full">
          <Check size={15} /> Save permission policy
        </Button>
      </fieldset>
      <p className="reference-note">
        <LockKeyhole size={13} /> Approval never bypasses blacklists, simulation
        failures, or the gas ceiling.
      </p>
    </form>
  );
}
