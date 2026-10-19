import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { z } from "zod";
import { runIntent } from "@/lib/agent/runner";
import { autoDrip, decide } from "@/lib/agent/tools";
import {
  createAgentAccount,
  listAccounts,
  resolveSession,
  unlockAccount,
  closeSession,
  requireStepUp,
} from "@/lib/auth/accountStore";
import { belongsToAccount, withAccount } from "@/lib/auth/context";
import { guardStatus, portfolio } from "@/lib/chain";
import {
  exclusive,
  ledger,
  log,
  policy,
  policyHash,
  policyFile,
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
  z.object({
    type: z.literal("intent"),
    accountId: z.string(),
    prompt: z.string().min(1).max(4000),
  }),
  z.object({
    type: z.literal("approval"),
    id: z.string().uuid(),
    approve: z.boolean(),
    accountId: z.string(),
    pin: z.string().max(64).optional(),
  }),
  z.object({
    type: z.literal("policy"),
    accountId: z.string(),
    policy: policySchema,
    pin: z.string().max(64).optional(),
  }),
  z.object({
    type: z.literal("account_create"),
    name: z.string().trim().min(1).max(80),
    profile: z.enum(["CONSERVATIVE", "BALANCED", "AGGRESSIVE"]),
    pin: z.string().regex(/^\d{6}$/),
  }),
  z.object({
    type: z.literal("account_switch"),
    id: z.string(),
    pin: z.string().max(64),
  }),
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

async function updatePolicy(
  settings: z.infer<typeof policySchema>,
  pin?: string,
) {
  return exclusive(async () => {
    await requireStepUp(pin, "POLICY_UPDATE");
    const previous = await policy();
    const next = { ...previous, ...settings };
    await saveJSON(policyFile(), next);
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
    const accounts = await listAccounts();
    let context;
    try {
      context = resolveSession(req.cookies.get("aegis_session")?.value);
    } catch {
      return NextResponse.json(
        { accounts, session: { status: "LOCKED" } },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    return await withAccount(context, async () => {
      const [l, p] = await Promise.all([ledger(), policy()]);
      const [live, guard, verification] = await Promise.all([
        settle(portfolio()),
        settle(guardStatus()),
        verifyLedger(l),
      ]);
      return NextResponse.json(
        {
          ledger: {
            logs: l.logs.filter(belongsToAccount),
            pending: l.pending.filter(belongsToAccount),
          },
          accounts,
          activeAccount: accounts.find((a) => a.id === context.id),
          session: {
            status: "ACTIVE",
            tier1:
              live.error || guard.error
                ? "UNAVAILABLE"
                : guard.value &&
                    (guard.value.sessionExpiry * 1000 <= Date.now() ||
                      guard.value.sessionKey.toLowerCase() !==
                        live.value?.agent.toLowerCase())
                  ? "EXPIRED"
                  : "ACTIVE",
          },
          policy: p,
          portfolio: live.value,
          guard: guard.value,
          verification,
          error: live.error || guard.error,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
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
    const oldToken = req.cookies.get("aegis_session")?.value;
    if (body.type === "account_create" || body.type === "account_switch") {
      const opened =
        body.type === "account_create"
          ? await createAgentAccount(
              body.name,
              "OPERATOR",
              body.pin,
              body.profile,
            )
          : await unlockAccount(body.id, body.pin);
      if (body.type === "account_create") await autoDrip(opened.account);
      const updated = (await listAccounts()).find(
        (a) => a.id === opened.account.id,
      )!;
      closeSession(oldToken);
      const response = NextResponse.json({
        result: { account: updated },
      });
      response.cookies.set("aegis_session", opened.token, {
        httpOnly: true,
        sameSite: "strict",
        secure: req.nextUrl.protocol === "https:",
        path: "/",
      });
      return response;
    }
    const context = resolveSession(oldToken);
    if (body.accountId !== context.id)
      throw new Error(
        "Account changed. Refresh before submitting this operation.",
      );
    return await withAccount(context, async () => {
      let result: unknown;
      if (body.type === "intent") result = await runIntent(body.prompt);
      else if (body.type === "approval")
        result = await decide(body.id, body.approve, body.pin);
      else result = await updatePolicy(body.policy, body.pin);
      return NextResponse.json({ result });
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
