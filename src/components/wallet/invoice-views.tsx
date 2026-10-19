"use client";

import {
  AlertTriangle,
  BadgeCheck,
  Check,
  FileText,
  ScanText,
  ShieldAlert,
} from "@/components/wallet/icons";
import { BorderBeam } from "@/components/godui/border-beam";
import { parseInvoice, type InvoiceRead } from "@/lib/agent/invoice";
import type { PayeeVerdict, Tier } from "@/lib/security/policyEngine";

export type InvoiceView = InvoiceRead & { payee?: PayeeVerdict; tier: Tier };

/** The operator's pasted invoice, shown as a document rather than a chat bubble. */
export function InvoiceDocument({
  text,
  reading = false,
}: {
  text: string;
  reading?: boolean;
}) {
  // Display only: the server reads the invoice itself and never trusts this label.
  const fields = parseInvoice(text);
  const summary = fields
    ? `${fields.vendor || "Unnamed vendor"}, ${fields.amount} ${fields.token}`
    : "Pasted document";
  return (
    <div className="invoice-document" data-reading={reading}>
      {reading && (
        <BorderBeam
          size={56}
          duration={2.6}
          borderWidth={1.5}
          rainbow={false}
          colorFrom="var(--emerald)"
          colorTo="var(--emerald-line)"
        />
      )}
      <div className="flex items-start gap-2.5">
        <FileText size={16} className="mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-xs font-medium">
            {fields?.invoiceNumber
              ? `Invoice ${fields.invoiceNumber}`
              : "Invoice"}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {reading ? "Aegis is reading this invoice…" : summary}
          </p>
        </div>
      </div>
      <details className="invoice-document-text">
        <summary>Show document</summary>
        <pre>{text}</pre>
      </details>
    </div>
  );
}

// Characters are compared case-insensitively: EIP-55 casing differs between any two addresses.
function runs(address: string, against: string) {
  const out: { text: string; same: boolean }[] = [];
  [...address].forEach((char, index) => {
    const same = char.toLowerCase() === against[index]?.toLowerCase();
    const last = out.at(-1);
    if (last && last.same === same) last.text += char;
    else out.push({ text: char, same });
  });
  return out;
}

function sharedEnds(a: string, b: string) {
  const x = a.slice(2).toLowerCase();
  const y = b.slice(2).toLowerCase();
  let head = 0;
  while (head < x.length && x[head] === y[head]) head++;
  let tail = 0;
  while (tail < x.length - head && x.at(-1 - tail) === y.at(-1 - tail)) tail++;
  return { head, tail };
}

function MarkedAddress({
  address,
  against,
  variant,
}: {
  address: string;
  against: string;
  variant: "paid" | "registered";
}) {
  return (
    <code className="address-diff" data-variant={variant}>
      {runs(address, against).map((run, index) =>
        run.same ? (
          <span key={index}>{run.text}</span>
        ) : (
          <mark key={index}>{run.text}</mark>
        ),
      )}
    </code>
  );
}

function AddressComparison({
  verdict,
  payTo,
}: {
  verdict: Extract<PayeeVerdict, { status: "mismatch" }>;
  payTo: string;
}) {
  const registered = verdict.payee.address;
  const { head, tail } = sharedEnds(payTo, registered);
  return (
    <div className="address-comparison">
      <dl>
        <div>
          <dt>This invoice pays</dt>
          <dd>
            <MarkedAddress
              address={payTo}
              against={registered}
              variant="paid"
            />
          </dd>
        </div>
        <div>
          <dt>Registered to {verdict.payee.name}</dt>
          <dd>
            <MarkedAddress
              address={registered}
              against={payTo}
              variant="registered"
            />
          </dd>
        </div>
      </dl>
      <p>
        {verdict.lookalike
          ? `It copies the first ${head} and last ${tail} characters of the registered address, the parts people usually check. The middle is different: an address-poisoning lookalike.`
          : `This is not the address on file for ${verdict.payee.name}.`}
      </p>
    </div>
  );
}

function PayeeCheck({
  payee,
  payTo,
  tier,
}: {
  payee?: PayeeVerdict;
  payTo: string;
  tier: Tier;
}) {
  if (payee?.status === "verified") {
    return (
      <li data-tone="success">
        <BadgeCheck size={14} />
        <div>
          Registered payee. {payee.payee.name} is paid at its vendor-book
          address.
        </div>
      </li>
    );
  }
  if (payee?.status === "mismatch") {
    return (
      <li data-tone="error">
        <ShieldAlert size={14} />
        <div>
          Payee mismatch. The invoice names {payee.payee.name}, but pays an
          address that is not on file for it.
          <AddressComparison verdict={payee} payTo={payTo} />
        </div>
      </li>
    );
  }
  // A block raised before the payee check explains itself in the reasons below.
  if (tier === "BLOCKED") return null;
  return (
    <li data-tone="pending">
      <AlertTriangle size={14} />
      <div>
        Not in your vendor book. A person must approve a payment to an unknown
        payee.
      </div>
    </li>
  );
}

/** What the reader extracted, and what deterministic code verified about it. */
export function InvoiceReadout({ invoice }: { invoice: InvoiceView }) {
  const meta = [
    invoice.invoiceNumber,
    invoice.dueDate && `due ${invoice.dueDate}`,
  ].filter(Boolean);
  return (
    <section className="invoice-readout" aria-label="Invoice read by the agent">
      <p className="invoice-readout-reader">
        <ScanText size={13} /> Read by {invoice.reader}
      </p>
      <div className="invoice-readout-head">
        <div className="min-w-0">
          <p className="invoice-readout-vendor">
            {invoice.vendor || "Vendor not stated"}
          </p>
          {meta.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              {meta.join(", ")}
            </p>
          )}
        </div>
        <p className="invoice-readout-total">
          {invoice.amount} <span>{invoice.token}</span>
        </p>
      </div>
      <p className="invoice-readout-payto">
        <span>Pay to</span>
        <code>{invoice.payTo}</code>
      </p>
      <ul className="invoice-checks">
        <li data-tone="success">
          <Check size={14} />
          <div>
            Document check passed. The amount and the pay-to address are written
            in the invoice.
          </div>
        </li>
        <PayeeCheck
          payee={invoice.payee}
          payTo={invoice.payTo}
          tier={invoice.tier}
        />
      </ul>
    </section>
  );
}
