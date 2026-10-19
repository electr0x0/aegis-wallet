"use client";

import { useState } from "react";
import { LockKeyhole } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function PinField({
  pin,
  setPin,
  demo = false,
}: {
  pin: string;
  setPin: (pin: string) => void;
  demo?: boolean;
}) {
  return (
    <div className="space-y-3">
      <label className="block space-y-2 text-sm">
        <span>6-Digit Operator PIN</span>
        <Input
          aria-label="6-Digit Operator PIN"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          className="font-mono tracking-[.5em]"
        />
      </label>
      {demo && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setPin("884210")}
        >
          Use Demo PIN: 884210
        </Button>
      )}
    </div>
  );
}

export function PinDialog({
  title,
  accountName,
  demo,
  onFinish,
}: {
  title: string;
  accountName?: string;
  demo: boolean;
  onFinish: (pin: string | null) => void;
}) {
  const [pin, setPin] = useState("");
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onFinish(null);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LockKeyhole size={18} />
            {title}
          </DialogTitle>
          <DialogDescription>
            Confirm with the operator PIN for {accountName ?? "this account"}.
            This authorizes only this operation.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (/^\d{6}$/.test(pin)) {
              onFinish(pin);
              setPin("");
            }
          }}
        >
          <PinField pin={pin} setPin={setPin} demo={demo} />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onFinish(null)}
            >
              Cancel
            </Button>
            <Button disabled={pin.length !== 6}>Confirm PIN</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
