// Independent, read-only evidence verifier. No keys, signing or file writes.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createPublicClient, http, isAddress, type Hex } from "viem";
import {
  parseEvidence,
  verifyEvidence,
  summaryLine,
  recordedGuard,
  ownerAbi,
  type Report,
} from "../src/lib/evidence/verify";
export * from "../src/lib/evidence/verify";
const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;
function printReport(report: Report) {
  const header = ["#", "status", "tx", "link", "hash", "sig", "on-chain"];
  const lines = report.rows.map((row, index) => [
    String(index + 1),
    row.entry.status,
    row.entry.txHash ? short(row.entry.txHash) : "-",
    row.link,
    row.hash,
    row.signature,
    row.onchain,
  ]);
  const widths = header.map((title, column) =>
    Math.max(title.length, ...lines.map((line) => line[column].length)),
  );
  const format = (cells: string[]) =>
    cells
      .map((cell, column) => cell.padEnd(widths[column]))
      .join("  ")
      .trimEnd();
  console.log(format(header));
  report.rows.forEach((row, index) => {
    console.log(format(lines[index]));
    for (const problem of row.problems) console.log(`    ! ${problem}`);
  });
  console.log("");
  console.log(
    `Ledger signer: ${report.signer ?? "unknown (pass --signer 0x...)"}`,
  );
  if (report.gaps) {
    console.log(
      "Gaps are links to entries outside this export. Check data/audit_log.json for the full chain.",
    );
  }
  console.log(summaryLine(report));
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      signer: { type: "string" },
      guard: { type: "string" },
      offline: { type: "boolean", default: false },
    },
  });
  if (values.signer && !isAddress(values.signer)) {
    throw new Error("--signer must be an address.");
  }
  if (values.guard && !isAddress(values.guard))
    throw new Error("--guard must be an address.");
  const file = positionals[0] ?? "data/audit_log.json";
  const evidence = parseEvidence(JSON.parse(readFileSync(file, "utf8")));
  const client = values.offline
    ? null
    : createPublicClient({
        // No chain object: the chain ID is checked against the RPC, never assumed.
        transport: http(
          process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
        ),
      });
  console.log(`Verifying ${file}`);
  // The owner is immutable in AgentGuard, so it is read from the chain, not from the file.
  const guard =
    (values.guard as Hex | undefined) ?? recordedGuard(evidence.entries);
  const guardOwner =
    client && guard
      ? await client.readContract({
          address: guard,
          abi: ownerAbi,
          functionName: "owner",
        })
      : undefined;
  const report = await verifyEvidence(evidence, {
    signer: values.signer as Hex | undefined,
    client,
    guardOwner,
    guard: guard ?? undefined,
  });
  printReport(report);
  if (!report.ok) process.exitCode = 1;
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((e) => {
    console.error((e as Error).message);
    process.exitCode = 1;
  });
}
