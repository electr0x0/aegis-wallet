import {
  decodeAbiParameters,
  parseAbi,
  parseAbiParameters,
  type Hex,
} from "viem";
import {
  EAS_ADDRESS,
  LEDGER_ANCHOR_SCHEMA,
  LEDGER_ANCHOR_SCHEMA_UID,
} from "../security/policyEngine";
import type { Evidence, Report } from "./verify";

// EAS IEAS.getAttestation and Common.Attestation (MIT), checked against upstream.
export const checkpointAbi = parseAbi([
  "struct Attestation { bytes32 uid; bytes32 schema; uint64 time; uint64 expirationTime; uint64 revocationTime; bytes32 refUID; address recipient; address attester; bool revocable; bytes data; }",
  "function getAttestation(bytes32 uid) view returns (Attestation)",
]);
export type Attestation = {
  uid: Hex;
  schema: Hex;
  time: bigint;
  expirationTime: bigint;
  revocationTime: bigint;
  refUID: Hex;
  recipient: Hex;
  attester: Hex;
  revocable: boolean;
  data: Hex;
};
export const checkpointRequest = (uid: Hex) => ({
  address: EAS_ADDRESS as Hex,
  abi: checkpointAbi,
  functionName: "getAttestation" as const,
  args: [uid] as const,
});

export function verifyCheckpoint(
  evidence: Evidence,
  report: Report,
  record: Attestation,
  uid: Hex,
  signer: Hex,
  now = BigInt(Math.floor(Date.now() / 1000)),
) {
  const problems: string[] = [];
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  if (!same(record.uid, uid) || record.time === 0n)
    problems.push("Attestation not found at this UID");
  if (!same(record.schema, LEDGER_ANCHOR_SCHEMA_UID))
    problems.push("Wrong ledger anchor schema");
  if (!same(record.attester, signer))
    problems.push("Attester differs from the expected signer");
  if (record.revocationTime !== 0n || record.revocable)
    problems.push("Checkpoint is revoked or revocable");
  if (record.expirationTime !== 0n && record.expirationTime <= now)
    problems.push("Checkpoint expired");
  const [head, count, policy] = decodeAbiParameters(
    parseAbiParameters(LEDGER_ANCHOR_SCHEMA),
    record.data,
  );
  if (count === 0n) problems.push("An empty checkpoint proves no history");
  if (!report.ok || evidence.entries.length === 0)
    problems.push("Evidence seals must pass first");
  let covered = false;
  let suffix: number | null = null;
  if (evidence.complete) {
    if (count > BigInt(evidence.entries.length))
      problems.push("Ledger is shorter than its anchored prefix");
    else {
      const index = Number(count) - 1;
      covered = index >= 0 && same(evidence.entries[index].hash ?? "", head);
      suffix = evidence.entries.length - Number(count);
      if (!covered)
        problems.push(
          "Anchored head differs from the ledger entry at that count",
        );
    }
  } else {
    // Gaps in an account export cannot prove the complete prefix or its length.
    covered = evidence.entries.some((e) => same(e.hash ?? "", head));
    problems.push(
      covered
        ? "Head appears in this account export; upload the full ledger to prove prefix coverage"
        : "Anchored head is outside this account export; prefix coverage is unknown",
    );
  }
  return {
    ok: problems.length === 0,
    uid,
    head,
    entryCount: count.toString(),
    policyHash: policy,
    anchoredAt: new Date(Number(record.time) * 1000).toISOString(),
    unanchoredEntries: suffix,
    complete: evidence.complete,
    headFound: covered,
    problems,
  };
}
export type CheckpointReport = ReturnType<typeof verifyCheckpoint>;
