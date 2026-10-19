"use client";

import { useState } from "react";
import { Check, ChevronDown, Copy, Plus, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { PinField } from "@/components/wallet/pin-dialog";
import { useWallet } from "@/components/wallet/wallet-provider";
import { shortAddress } from "@/components/wallet/types";
import type { PublicAccount, RiskProfile } from "@/lib/auth/accountStore";

export function AccountSwitcher() {
  const { accountState, snapshot, changeAccount, busy, setNotice } =
    useWallet();
  const { accounts, activeAccount: active, session } = accountState;
  const [mode, setMode] = useState<"create" | PublicAccount | null>(null);
  const [name, setName] = useState("");
  const [profile, setProfile] = useState<RiskProfile>("BALANCED");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [working, setWorking] = useState(false);
  const open = (value: typeof mode) => {
    setMode(value);
    setPin("");
    setError("");
    setName("");
    setProfile("BALANCED");
  };
  const balances = snapshot?.portfolio?.balances;
  const label =
    session.status === "LOCKED" ? "LOCKED" : (session.tier1 ?? "UNAVAILABLE");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!mode || working) return;
    setWorking(true);
    setError("");
    try {
      await changeAccount(
        mode === "create"
          ? { type: "account_create", name, profile, pin }
          : { type: "account_switch", id: mode.id, pin },
      );
      open(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
      setPin("");
    }
  }
  return (
    <div className="account-switcher">
      <div className="account-switcher-main">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="account-trigger"
              disabled={busy || working}
              aria-label="Switch agent account"
            >
              <Wallet size={17} />
              <span className="truncate">
                {active?.name ?? "Unlock agent account"}
              </span>
              <ChevronDown size={14} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-80 max-w-[calc(100vw-2rem)]"
          >
            <DropdownMenuLabel>Agent accounts · Base Sepolia</DropdownMenuLabel>
            {active && (
              <p className="px-2 pb-2 text-xs text-muted-foreground">
                {active.role} ·{" "}
                {active.id === "master"
                  ? "Environment-isolated key (software)"
                  : "PIN-encrypted key"}
              </p>
            )}
            {accounts.map((a) => (
              <DropdownMenuItem key={a.id} onSelect={() => open(a)}>
                <div className="min-w-0 flex-1">
                  <div className="truncate">{a.name}</div>
                  <div className="text-xs font-mono text-muted-foreground">
                    {shortAddress(a.address)}
                  </div>
                </div>
                {a.id === active?.id && <Check size={15} />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => open("create")}>
              <Plus size={16} />
              Provision New Agent Wallet
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {active && (
          <Button
            variant="ghost"
            size="sm"
            aria-label="Copy active wallet address"
            className="font-mono text-xs"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(active.address);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {
                setNotice(
                  "Clipboard unavailable. Copy the wallet address from Portfolio.",
                );
              }
            }}
          >
            {shortAddress(active.address)}
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </Button>
        )}
      </div>
      <div className="account-session-meta">
        <span
          className={
            label === "ACTIVE"
              ? "text-[var(--emerald)]"
              : "text-muted-foreground"
          }
        >
          Tier 1 Session{" "}
          {snapshot?.portfolio?.mode === "guard" ? "Key" : "(server EOA)"}:{" "}
          {label}
        </span>
        <span>
          Base Sepolia ·{" "}
          {snapshot?.portfolio?.mode === "guard" ? "Guard treasury · " : ""}
          {balances
            ? `${Number(balances.ETH).toFixed(5)} ETH · ${Number(balances.USDC).toFixed(2)} USDC`
            : "Balances unavailable"}
        </span>
      </div>
      <Dialog
        open={mode !== null}
        onOpenChange={(value) => {
          if (!value && !working) open(null);
        }}
      >
        <DialogContent
          className="max-h-[90vh] overflow-y-auto"
          showCloseButton={!working}
        >
          <DialogHeader>
            <DialogTitle>
              {mode === "create"
                ? "Provision a new agent wallet"
                : "Unlock agent session"}
            </DialogTitle>
            <DialogDescription>
              {mode === "create"
                ? "Create a Base Sepolia wallet with your own PIN and permission preset. A one-time 0.0003 ETH gas drip is attempted when the master reserve and policy allow it."
                : `Enter the PIN for ${typeof mode === "object" ? mode?.name : "this account"}. Sessions expire after 30 minutes.`}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-5">
            {mode === "create" && (
              <>
                <label className="block space-y-2 text-sm">
                  <span>Organization / User Name</span>
                  <Input
                    value={name}
                    maxLength={80}
                    required
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <fieldset className="space-y-2">
                  <legend className="mb-2 text-sm">Risk Profile Preset</legend>
                  {(
                    [
                      ["CONSERVATIVE", "Conservative ($1 Auto-Limit)"],
                      ["BALANCED", "Balanced ($2 Auto-Limit)"],
                      ["AGGRESSIVE", "Aggressive ($10 Auto-Limit)"],
                    ] as const
                  ).map(([value, label]) => (
                    <label
                      key={value}
                      className="flex cursor-pointer items-center gap-3 rounded-md border p-3 text-sm"
                    >
                      <input
                        type="radio"
                        name="profile"
                        checked={profile === value}
                        value={value}
                        onChange={() => setProfile(value)}
                      />
                      {label}
                    </label>
                  ))}
                </fieldset>
              </>
            )}
            <PinField
              pin={pin}
              setPin={setPin}
              demo={typeof mode === "object" && mode?.id === "master"}
            />
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button
              className="w-full"
              disabled={
                working ||
                pin.length !== 6 ||
                (mode === "create" && !name.trim())
              }
            >
              {working
                ? "Preparing wallet…"
                : mode === "create"
                  ? "Create wallet & open session"
                  : "Unlock session"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
