"use client";

import { useState } from "react";
import { ReceiptText, ScanText } from "@/components/wallet/icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { TierBadge } from "./console-views";
import { SAMPLE_INVOICES } from "./invoices";

// Exactly the text in the editor is sent: what the operator sees is what the agent reads.
export function InvoiceInbox({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(SAMPLE_INVOICES[0].id);
  const [text, setText] = useState(SAMPLE_INVOICES[0].text);
  const sample = SAMPLE_INVOICES.find((s) => s.id === selected);
  const edited = sample?.text !== text;
  const pick = (id: string) => {
    setSelected(id);
    setText(SAMPLE_INVOICES.find((s) => s.id === id)?.text ?? "");
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          className="invoice-trigger mb-2.5 h-auto w-full justify-start gap-2.5 py-2 text-left"
        >
          <ReceiptText size={15} aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-medium">Pay an invoice</span>
            <span className="block truncate text-[10px] font-normal text-muted-foreground">
              AI reads it, the vendor book verifies who gets paid
            </span>
          </span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Invoice inbox</DialogTitle>
          <DialogDescription>
            Pick an invoice or paste your own. Aegis reads it, checks the payee
            against your vendor book, and then applies the same policy as every
            other payment.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid min-w-0 gap-4 md:grid-cols-[230px_minmax(0,1fr)]"
          onSubmit={(event) => {
            event.preventDefault();
            if (!text.trim() || disabled) return;
            setOpen(false);
            onSubmit(text);
          }}
        >
          <RadioGroup
            aria-label="Sample invoices"
            value={selected}
            onValueChange={pick}
            className="content-start gap-2"
          >
            {SAMPLE_INVOICES.map((invoice) => (
              <label
                key={invoice.id}
                className="invoice-option"
                data-checked={invoice.id === selected}
              >
                <RadioGroupItem value={invoice.id} className="mt-0.5" />
                <span className="min-w-0">
                  <span className="block text-xs font-medium leading-snug">
                    {invoice.title}
                  </span>
                  <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                    {invoice.tag}
                    <TierBadge tier={invoice.tier} />
                  </span>
                </span>
              </label>
            ))}
          </RadioGroup>
          <div className="min-w-0">
            <label htmlFor="invoice-text" className="sr-only">
              Invoice text
            </label>
            <Textarea
              id="invoice-text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={4000}
              rows={15}
              spellCheck={false}
              className="invoice-paper"
            />
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              {edited
                ? "Edited. The sample's expected outcome no longer applies; live policy decides."
                : sample?.teaches}
            </p>
          </div>
          <DialogFooter className="md:col-span-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={disabled || !text.trim()}>
              <ScanText size={15} aria-hidden /> Ask Aegis to pay
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
