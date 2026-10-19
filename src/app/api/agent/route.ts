import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { z } from "zod";
import { runIntent } from "@/lib/agent/runner";
import { decide } from "@/lib/agent/tools";
import { guardStatus, portfolio } from "@/lib/chain";
import {
  exclusive,
  ledger,
  log,
  policy,
  policyHash,
  saveJSON,
  saveLedger,
  verifyLedger,
} from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

const policySchema = z.object({
  tier1SingleTxMaxUsd: z.number().min(0).max(10000),
  tier1DailyLimitUsd: z.number().min(0).max(10000),
  maxGasGwei: z.number().positive().max(1000),
  whitelistedAddresses: z.array(z.string().refine(isAddress)).max(100),
  requireApproval: z.boolean(),
  treasury: z
    .object({
      fiatReserveUsd: z.number().min(0).max(1e9),
      monthlyExpensesUsd: z.number().positive().max(1e8),
      minRunwayMonths: z.number().min(0).max(120),
    })
    .optional(),
});

const postSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("intent"), prompt: z.string().min(1).max(4000) }),
  z.object({
    type: z.literal("approval"),
    id: z.string().uuid(),
    approve: z.boolean(),
  }),
  z.object({ type: z.literal("policy"), policy: policySchema }),
]);

// Loopback host plus exact same-origin mutations: no remote access, no browser CSRF.
function assertLocalOperator(req: NextRequest) {
  const authority = req.headers.get("host") || "";
  const host = new URL(`http://${authority}`).hostname;
  if (!LOCAL_HOSTS.includes(host))
    throw new Error("Local operator access only");
  const origin = req.headers.get("origin");
  if (
    req.method !== "GET" &&
    origin !== `${req.nextUrl.protocol}//${authority}`
  ) {
    throw new Error("Same-origin operator request required");
  }
}

async function settle<T>(promise: Promise<T>) {
  try {
    return { value: await promise, error: "" };
  } catch (e) {
    return { value: null, error: (e as Error).message };
  }
}

async function updatePolicy(settings: z.infer<typeof policySchema>) {
  return exclusive(async () => {
    const previous = await policy();
    const next = { ...previous, ...settings };
    await saveJSON("policy.json", next);
    // Loosening a limit is itself an auditable act, so it enters the sealed ledger.
    const l = await ledger();
    log(l, {
      intent: "POLICY_UPDATE",
      tier: "TIER_0",
      status: "COMPLETED",
      simulation: "NOT_APPLICABLE",
      reasons: [`Policy ${policyHash(previous)} → ${policyHash(next)}`],
      riskScore: 0,
      usd: 0,
      rationale: "Operator changed the permission policy.",
      policyHash: policyHash(next),
    });
    await saveLedger(l);
    return next;
  });
}

export async function GET(req: NextRequest) {
  try {
    assertLocalOperator(req);
    const [l, p] = await Promise.all([ledger(), policy()]);
    const [live, guard, verification] = await Promise.all([
      settle(portfolio()),
      settle(guardStatus()),
      verifyLedger(l),
    ]);
    return NextResponse.json({
      ledger: l,
      policy: p,
      portfolio: live.value,
      guard: guard.value,
      verification,
      error: live.error || guard.error,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }
}

export async function POST(req: NextRequest) {
  try {
    assertLocalOperator(req);
    const parsed = postSchema.safeParse(await req.json());
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const unknown = !issue || issue.code === "invalid_union_discriminator";
      throw new Error(
        unknown
          ? "Unknown operation"
          : `${issue.path.join(".")}: ${issue.message}`,
      );
    }
    const body = parsed.data;
    let result: unknown;
    if (body.type === "intent") result = await runIntent(body.prompt);
    else if (body.type === "approval")
      result = await decide(body.id, body.approve);
    else result = await updatePolicy(body.policy);
    return NextResponse.json({ result });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
