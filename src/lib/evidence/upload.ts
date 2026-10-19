import { z } from "zod";
import { isAddress, type Hex } from "viem";
import { publicClient } from "../chain";
import {
  ownerAbi,
  parseEvidence,
  recordedGuard,
  summaryLine,
  verifyEvidence,
} from "./verify";
import {
  checkpointRequest,
  verifyCheckpoint,
  type CheckpointReport,
} from "./checkpoint";

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const entrySchema = z
  .object({
    id: z.string().min(1).max(128),
    intent: z.string().max(10000),
    status: z.string().max(80),
    accountId: z.string().max(128).optional(),
    simulation: z.string().max(20000).optional(),
    rationale: z.string().max(20000).optional(),
    reasons: z.array(z.string().max(20000)).max(100).optional(),
    txHash: hex32.optional(),
    prevHash: hex32.optional(),
    hash: hex32.optional(),
    signature: z
      .string()
      .regex(/^0x[0-9a-fA-F]{130}$/)
      .optional(),
    signer: z.string().refine(isAddress).optional(),
  })
  .passthrough();
export const evidenceRequestSchema = z
  .object({
    text: z.string().min(2).max(2_000_000),
    signer: z.string().refine(isAddress),
    online: z.boolean(),
    checkpointUid: hex32.optional(),
    guard: z.string().refine(isAddress).optional(),
  })
  .strict();
export function parseUpload(text: string, online: boolean) {
  if (text.length > 2_000_000)
    throw new Error("Evidence exceeds 2 MB text limit");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Evidence must be valid JSON");
  }
  const evidence = parseEvidence(raw);
  const checked = z
    .array(entrySchema)
    .min(1)
    .max(1000)
    .safeParse(evidence.entries);
  if (!checked.success) {
    const issue = checked.error.issues[0];
    throw new Error(
      `Invalid evidence at ${issue.path.join(".") || "entries"}: ${issue.message}`,
    );
  }
  if (
    online &&
    new Set(evidence.entries.map((e) => e.txHash).filter(Boolean)).size > 50
  )
    throw new Error(
      "Online verification is limited to 50 distinct transactions; use the CLI for larger ledgers",
    );
  return evidence;
}
export async function verifyUpload(input: unknown) {
  const request = evidenceRequestSchema.parse(input);
  if (request.checkpointUid && !request.online)
    throw new Error("EAS verification requires online mode");
  const evidence = parseUpload(request.text, request.online);
  const signer = request.signer as Hex;
  if (request.online && (await publicClient.getChainId()) !== 84532)
    throw new Error("Base Sepolia chain 84532 required");
  const guard =
    (request.guard as Hex | undefined) ?? recordedGuard(evidence.entries);
  const guardOwner =
    request.online && guard
      ? await publicClient.readContract({
          address: guard,
          abi: ownerAbi,
          functionName: "owner",
        })
      : undefined;
  const report = await verifyEvidence(evidence, {
    signer,
    client: request.online ? publicClient : null,
    guardOwner,
    guard: guard ?? undefined,
  });
  let checkpoint: CheckpointReport | null = null;
  let checkpointError = "";
  if (request.checkpointUid) {
    try {
      const uid = request.checkpointUid as Hex;
      const record = await publicClient.readContract(checkpointRequest(uid));
      checkpoint = verifyCheckpoint(evidence, report, record, uid, signer);
    } catch {
      checkpointError =
        "Checkpoint could not be read or decoded. Coverage is unverified.";
    }
  }
  // Return a bounded diagnostic report, not the uploaded prompts or arbitrary entry fields.
  return {
    verifiedAt: new Date().toISOString(),
    chainId: request.online ? 84532 : null,
    signer,
    guard,
    complete: evidence.complete,
    ok: report.ok && (!request.checkpointUid || Boolean(checkpoint?.ok)),
    sealsAndReceiptsOk: report.ok,
    summary: summaryLine(report),
    entries: report.rows.length,
    gaps: report.gaps,
    signatures: report.validSignatures,
    receipts: report.receipts,
    checkpoint,
    checkpointError,
    rows: report.rows.map((r, i) => ({
      index: i + 1,
      id: r.entry.id,
      status: r.entry.status,
      txHash: r.entry.txHash,
      link: r.link,
      hash: r.hash,
      signature: r.signature,
      onchain: r.onchain,
      problems: r.problems,
    })),
  };
}
export type EvidenceReport = Awaited<ReturnType<typeof verifyUpload>>;
