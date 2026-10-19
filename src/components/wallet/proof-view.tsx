"use client";
import { useState } from "react";
import { Download, FileCheck2, Upload } from "lucide-react";
import { BentoGrid, BentoCard } from "@/components/godui/bento-grid";
import { AgentStep, AgentTimeline } from "@/components/godui/agent-timeline";
import { FilterBar, type FilterValue } from "@/components/godui/filter-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ConsoleCard, TransactionLink } from "./console-views";
import { useWallet } from "./wallet-provider";
import { judgeReadiness } from "@/lib/judge/readiness";
import type { EvidenceReport } from "@/lib/evidence/upload";

function download(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
export function ProofView() {
  const wallet = useWallet();
  const [signer, setSigner] = useState(
    wallet.accountState.accounts.find((a) => a.id === "master")?.address ?? "",
  );
  const [text, setText] = useState("");
  const [source, setSource] = useState("");
  const [online, setOnline] = useState(true);
  const [uid, setUid] = useState("");
  const [guard, setGuard] = useState(wallet.snapshot?.guard?.address ?? "");
  const [error, setError] = useState("");
  const [report, setReport] = useState<EvidenceReport | null>(null);
  const [filters, setFilters] = useState<FilterValue>({});
  const items = judgeReadiness(wallet.snapshot);
  const rows =
    report?.rows.filter(
      (r) =>
        !filters.result?.length ||
        filters.result.includes(r.problems.length ? "issues" : "passed"),
    ) ?? [];
  const disabled = wallet.busy || wallet.sessionLocked;
  function currentEvidence() {
    setText(JSON.stringify(wallet.snapshot?.ledger.logs ?? []));
    setSource("Current account export (may contain gaps)");
    setReport(null);
    setError("");
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Judge proof</h1>
          <p className="supporting-copy mt-1">
            Inspect readiness, verify evidence independently and export the
            result.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={!wallet.snapshot}
          onClick={() =>
            download(
              {
                generatedAt: new Date().toISOString(),
                scope:
                  "Base Sepolia testnet operator readiness, not a security certification",
                account: wallet.snapshot?.activeAccount?.address,
                readiness: items,
                evidenceVerification: report,
              },
              "aegis-judge-report.json",
            )
          }
        >
          <Download size={14} />
          Export judge report
        </Button>
      </div>
      <ConsoleCard title="Live demonstration readiness">
        <BentoGrid columns={2} className="console-grid auto-rows-auto">
          {items.map((item) => (
            <BentoCard key={item.id} className="rounded-lg p-3">
              <div className="flex items-center justify-between gap-2 text-xs">
                <h3 className="font-medium">{item.title}</h3>
                <span
                  className={
                    item.status === "ready"
                      ? "text-primary"
                      : "text-muted-foreground"
                  }
                >
                  {item.status === "ready"
                    ? "READY"
                    : item.status === "attention"
                      ? "REVIEW"
                      : "UNKNOWN"}
                </span>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                {item.detail}
              </p>
            </BentoCard>
          ))}
        </BentoGrid>
        <p className="mt-3 text-[10px] text-muted-foreground">
          Read-only snapshot. This checklist does not fund wallets, change
          policy, renew a guard or test provider credentials.
        </p>
      </ConsoleCard>
      <ConsoleCard title="Independent evidence verifier">
        <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
          Verify canonical hashes, EIP-191 signatures, links and receipt claims
          using the independent CLI verifier core. Expected signer is a public
          address you trust separately. A valid signature alone does not prove
          the ledger is complete.
        </p>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            setReport(null);
            try {
              setReport(
                await wallet.verifyEvidence(
                  text,
                  signer,
                  online,
                  uid.trim() || undefined,
                  guard.trim() || undefined,
                ),
              );
            } catch (e) {
              setError((e as Error).message);
            }
          }}
          onChange={() => setReport(null)}
        >
          <fieldset disabled={disabled} className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={currentEvidence}
              >
                <FileCheck2 size={14} />
                Use current account evidence
              </Button>
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs">
                <Upload size={14} />
                Import full ledger or export
                <Input
                  type="file"
                  accept=".json,application/json"
                  className="max-w-60 text-[10px]"
                  aria-label="Import evidence JSON"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setReport(null);
                    setError("");
                    setText("");
                    try {
                      if (file.size > 2_000_000)
                        throw new Error("Evidence file must be under 2 MB");
                      const content = await file.text();
                      setText(content);
                      setSource(file.name);
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                />
              </label>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {source ||
                "Choose evidence to check. Full ledger objects prove links from genesis; account arrays may contain gaps."}
            </p>
            <label className="block space-y-2 text-xs">
              <span>Expected ledger signer (public address)</span>
              <Input
                required
                value={signer}
                onChange={(e) => setSigner(e.target.value)}
                maxLength={42}
                placeholder="0x…"
              />
            </label>
            <label className="flex items-center justify-between gap-3 text-xs">
              Read Base Sepolia receipts
              <Switch
                checked={online}
                onCheckedChange={(v) => {
                  setOnline(v);
                  setUid("");
                  setReport(null);
                }}
              />
            </label>
            <label className="block space-y-2 text-xs">
              <span>Expected AgentGuard (optional public address)</span>
              <Input
                value={guard}
                onChange={(e) => setGuard(e.target.value)}
                maxLength={42}
                placeholder="0x… · needed if deployment is outside the export"
              />
            </label>
            {online && (
              <label className="block space-y-2 text-xs">
                <span>EAS checkpoint UID (optional)</span>
                <Input
                  value={uid}
                  onChange={(e) => setUid(e.target.value)}
                  maxLength={66}
                  placeholder="0x… · attestation UID, not transaction hash"
                />
              </label>
            )}
            <Button type="submit" disabled={!text || disabled}>
              <FileCheck2 size={14} />
              {disabled ? "Checking…" : "Verify selected evidence"}
            </Button>
          </fieldset>
        </form>
        {error && (
          <p role="alert" className="mt-3 text-xs text-destructive">
            {error}
          </p>
        )}
        {report && (
          <div className="mt-5 space-y-4" aria-live="polite">
            <AgentTimeline>
              <AgentStep
                title={
                  report.ok
                    ? "Selected evidence checks passed"
                    : "Evidence contains verification failures"
                }
                status={report.ok ? "success" : "error"}
                defaultOpen
              >
                {report.summary}
              </AgentStep>
              <AgentStep
                title={
                  report.complete
                    ? "Full ledger format selected"
                    : "Filtered export: completeness is unproven"
                }
                status={
                  report.complete && report.sealsAndReceiptsOk
                    ? "success"
                    : "pending"
                }
                defaultOpen
              >
                {report.complete
                  ? "Genesis links checked. Tail deletion requires a trusted checkpoint to detect."
                  : `${report.gaps} gaps. Missing account history and tail deletion cannot be ruled out.`}
              </AgentStep>
              <AgentStep
                title={
                  report.receipts
                    ? `${report.receipts.matched}/${report.receipts.checked} unique receipts match`
                    : "Receipts were not checked"
                }
                status={
                  report.receipts
                    ? report.receipts.checked > 0 &&
                      report.receipts.checked === report.receipts.matched
                      ? "success"
                      : report.receipts.checked === 0
                        ? "pending"
                        : "error"
                    : "pending"
                }
                defaultOpen
              >
                Receipt checks cover chain, status, master sender, recorded
                recipient and guard path where recorded. They do not certify an
                external business purpose.
              </AgentStep>
              <AgentStep
                title={
                  report.checkpoint?.ok
                    ? "EAS anchored prefix matches"
                    : report.checkpoint || report.checkpointError
                      ? "EAS prefix is unverified or mismatched"
                      : "EAS checkpoint not selected"
                }
                status={
                  report.checkpoint?.ok
                    ? "success"
                    : report.checkpoint || report.checkpointError
                      ? "error"
                      : "pending"
                }
                defaultOpen
                last
              >
                {report.checkpoint
                  ? `${report.checkpoint.entryCount} anchored entries · ${report.checkpoint.unanchoredEntries ?? "unknown"} unanchored entries. ${report.checkpoint.problems.join("; ")}`
                  : report.checkpointError ||
                    "Import a full ledger and enter its attestation UID to check prefix coverage."}
              </AgentStep>
            </AgentTimeline>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <FilterBar
                value={filters}
                onChange={setFilters}
                facets={[
                  {
                    id: "result",
                    label: "Verification result",
                    options: [
                      { label: "Passed rows", value: "passed" },
                      { label: "Rows with issues", value: "issues" },
                    ],
                  },
                ]}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  download(report, "aegis-evidence-verification.json")
                }
              >
                <Download size={13} />
                Export verification
              </Button>
            </div>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-left text-[10px]">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="p-2">Entry / state</th>
                    <th className="p-2">Seal / link</th>
                    <th className="p-2">Receipt</th>
                    <th className="p-2">Findings</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={`${row.index}-${row.id}`}
                      className="border-b last:border-0"
                    >
                      <td className="p-2">
                        #{row.index} · {row.status}
                        <div className="mt-1">
                          <TransactionLink hash={row.txHash} />
                        </div>
                      </td>
                      <td className="p-2">
                        Hash {row.hash}
                        <br />
                        Signature {row.signature}
                        <br />
                        Link {row.link}
                      </td>
                      <td className="p-2">{row.onchain}</td>
                      <td className="max-w-64 p-2 [overflow-wrap:anywhere]">
                        {row.problems.join("; ") ||
                          "No issue in selected checks"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Checked {new Date(report.verifiedAt).toLocaleString()} ·{" "}
              {report.chainId
                ? `RPC chain ${report.chainId}`
                : "Offline seal checks"}
              . A checkpoint protects only its prefix; its key holder can attest
              new history. This is not an audit certification.
            </p>
          </div>
        )}
      </ConsoleCard>
    </div>
  );
}
