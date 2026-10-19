// Operator step: anchor the sealed ledger head on the Ethereum Attestation Service (Base Sepolia).
//
//   pnpm ledger:anchor              register the fixed schema if missing, then attest the head
//   pnpm ledger:anchor --dry-run    policy and simulation only; nothing is signed
//
// Not a planner tool. Both writes go through executeAction, like setup-wallets. They are
// zero-value calls sent from the agent EOA, because AgentGuard's allowlist excludes EAS.
// This is a second ledger writer: run it while the dashboard is idle.
import { EXPLORER, anchorSchemaRegistered } from "../src/lib/chain";
import { anchorLedger } from "../src/lib/agent/tools";
import { LEDGER_ANCHOR_SCHEMA_UID } from "../src/lib/security/policyEngine";

const EASSCAN = "https://base-sepolia.easscan.org";

type Outcome = Awaited<ReturnType<typeof anchorLedger>> & {
  txHash?: string;
  status?: string;
  attestationUid?: string;
};

function report(step: string, outcome: Outcome) {
  console.log(`\n${step}: ${outcome.rationale}`);
  if (outcome.txHash) {
    console.log(
      `Transaction (${outcome.status}): ${EXPLORER}/tx/${outcome.txHash}`,
    );
  }
  if (outcome.attestationUid) {
    console.log(
      `Attestation: ${EASSCAN}/attestation/view/${outcome.attestationUid}`,
    );
  }
  console.log("Technical details:", JSON.stringify(outcome, null, 2));
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`Schema: ${EASSCAN}/schema/view/${LEDGER_ANCHOR_SCHEMA_UID}`);

  if (!(await anchorSchemaRegistered())) {
    const registration: Outcome = await anchorLedger(
      "register_anchor_schema",
      dryRun,
    );
    report("Schema registration", registration);
    if (dryRun) {
      console.log(
        "\nDry run: the attestation needs the schema registered first.",
      );
      return;
    }
    if (registration.status !== "CONFIRMED") {
      throw new Error("Schema registration did not confirm; not attesting.");
    }
  }

  const anchor: Outcome = await anchorLedger("anchor_ledger", dryRun);
  report("Ledger anchor", anchor);
  if (!dryRun && anchor.status !== "CONFIRMED") process.exitCode = 1;
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
