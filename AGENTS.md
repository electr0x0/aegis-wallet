# AGENTS.md — AegisWallet

Instructions for every coding agent (Claude Code, Codex, Cursor, subagents) in this repo. `CLAUDE.md` imports this file; edit here only.

## What this is

AegisWallet is an AI wallet agent on **Base Sepolia (chain 84532)**. An LLM or deterministic planner proposes on-chain actions. A **deterministic policy gate** decides whether each action runs autonomously, waits for a human, or is blocked. Server-side viem signing; append-only JSON ledger; Next.js 15 operator dashboard built on GodUI.

Entry for the **2026 Shenzhen International FinTech Competition, Track F "Agent Wallet"**. Deadline **20 Oct 2026 23:59 UTC+8**. Scoring: task completion 40%, security and compliance 30%, innovation and interaction 30%, plus 0–5 bonus for on-chain exploration. Every change should move one of those numbers.

| Deliverable                            | Lives in                                    |
| -------------------------------------- | ------------------------------------------- |
| 01 Technical documentation             | `docs/01_TECHNICAL_DOCUMENTATION.md`        |
| 04 Source code, tests, deploy steps    | repo, `tests/`, `README.md`                 |
| 05 Security self-assessment            | `docs/05_SECURITY_SELF_ASSESSMENT.md`       |
| 06 Execution evidence (real tx hashes) | dashboard export from `data/audit_log.json` |

## Commands

```powershell
pnpm install --frozen-lockfile
pnpm setup-wallets              # creates .env.local; once funded, seeds two real evidence txs (each attempted once)
pnpm guard:compile              # solc 0.8.37: contracts/AgentGuard.sol -> src/lib/guard/AgentGuard.json
pnpm guard:deploy               # deploy AgentGuard, write GUARD_ADDRESS, move --eth (default 0.002) and all agent USDC in
pnpm guard:deploy --fund-only   # top up an existing guard (--eth, --usdc)
pnpm guard:deploy --renew       # owner-signed setSession, relayed by the session key
pnpm guard:attack               # compromised session key vs AgentGuard, simulation only
pnpm guard:attack --broadcast   # also send attack (a): a real reverted tx for evidence
pnpm dev                        # http://127.0.0.1:3000
pnpm test                       # vitest
pnpm typecheck
pnpm build
pnpm exec prettier --write <files>
```

pnpm only. Never create `package-lock.json` or `yarn.lock`.

## Map

| Path                                                | Role                                                                                                                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/security/policyEngine.ts`                  | Pure tier decision: `TIER_0`, `TIER_1_AUTO`, `TIER_2_HITL`, `BLOCKED`, plus the deterministic rationale (`explainDecision`) and the shared `ADVERSARIAL` pattern. No I/O. |
| `src/lib/security/bytecode.ts`                      | Static bytecode heuristics for `audit_contract_address`. Advisory only; not part of the tier decision.                                                                    |
| `src/lib/agent/tools.ts`                            | Validation, simulation, policy, guard pre-flight, reservation, broadcast, approvals. The only path from an agent intent to a signature.                                   |
| `src/lib/agent/runner.ts`                           | Intent routing and refusals, the demo regex parser, and the bounded LLM planner (5 rounds, 4 tool calls, stops at the first hold, block or broadcast).                    |
| `src/lib/chain.ts`                                  | viem clients, token constants, tx encoding, guard call wrapping (`outerCall`), owner-approval signing with a local digest check, guard error decoding, portfolio reads.   |
| `src/lib/store.ts`                                  | Atomic JSON writes, the process-wide `exclusive()` mutex, ledger sealing (hash chain plus agent EIP-191 signature) and `verifyLedger`.                                    |
| `src/app/api/agent/route.ts`                        | Single local-only, same-origin API.                                                                                                                                       |
| `contracts/AgentGuard.sol`                          | On-chain session-key guard (Layer 3). Not ERC-4337.                                                                                                                       |
| `src/lib/guard/AgentGuard.json`                     | Generated ABI and bytecode. Output of `pnpm guard:compile`; never hand-edit.                                                                                              |
| `scripts/setup-wallets.ts`                          | Key generation and the two evidence txs, via `executeAction`.                                                                                                             |
| `scripts/deploy-guard.ts`, `scripts/attack-demo.ts` | Operator scripts: guard deploy, fund and renew; compromised-key attack demo. See rule 11.                                                                                 |
| `scripts/compile-guard.mjs`                         | Pinned-solc compile of the guard.                                                                                                                                         |
| `src/components/godui/`, `src/components/ui/`       | GodUI and shadcn source. See `docs/GODUI_INTEGRATION.md`.                                                                                                                 |
| `src/components/wallet/`                            | Dashboard: intent studio (demo prompts), approval card, guard panel, runway tile, evidence.                                                                               |
| `tests/`                                            | Vitest: policy engine, execution and approvals (EOA mode), API boundary, approval UI. No contract tests yet.                                                              |
| `data/policy.json`                                  | Committed default policy. `data/audit_log.json` is private and ignored.                                                                                                   |
| `docs/DEMO_SCRIPT.md`                               | Demo video and live-final script, deck outline, submission checklist.                                                                                                     |
| `docs/06_EXECUTION_EVIDENCE.md`                     | Deliverable 06: real transaction hashes. Only hashes the chain returned (rule 6).                                                                                         |

## Hard rules

Breaking one of these is a bug, whatever the diff looks like.

1. **The model never decides.** Every write goes through `executeAction` → `evaluateTransactionPolicy`. No tool, route or script may call `wallet().sendTransaction` directly (the two operator scripts in rule 11 are the only exceptions), and LLM arguments can never replace the stored original prompt.
2. **Hard blocks are final.** Blacklist, failed simulation, wrong chain and gas ceiling cannot be overridden by human approval. Approval re-runs simulation and current policy.
3. **Reserve before broadcast; never auto-retry.** Persist `BROADCASTING` before sending and the hash before awaiting a receipt. Unknown outcomes stay reserved for manual reconciliation.
4. **All ledger and policy writes run inside `exclusive()`.** One Node process, one writer.
5. **Keys stay on the server.** Never log, return, export or `NEXT_PUBLIC_`-prefix a private key. `.env*` (except `.env.example`) and `data/audit_log.json` are never committed.
6. **Never fabricate evidence.** No placeholder balances, hashes or "success" states anywhere: UI, docs, deck or tests presented as live runs. Show only what the chain returned.
7. **Base Sepolia only.** Chain ID 84532 is checked before every simulation. Mainnet support needs a written decision and a security-doc update first.
8. **New on-chain capability = full set, same commit.** That means typed tool, Zod schema, policy coverage, a test in `tests/`, and a row in the risk matrix in `docs/05_SECURITY_SELF_ASSESSMENT.md`. No arbitrary contract calls, token approvals or swaps without all five.
9. **Money in base units.** New value math uses `bigint` via viem `parseUnits` and `formatUnits`; format only for display. Floating-point USD valuation is a documented known risk and should not spread.
10. **Docs stay true.** If behaviour changes, update `docs/01_*`, `docs/05_*` and the README in the same commit. Judges read the docs before the code.
11. **Only two scripts sign outside `executeAction`.**
    - `scripts/deploy-guard.ts` does operator setup: deploy, fund, owner-signed renew.
    - `scripts/attack-demo.ts` bypasses Layer 1 on purpose to prove Layer 3.
    - Both record every broadcast in the ledger. Nothing else may sign directly.
    - Like `setup-wallets`, they run as a separate process, so they are a second ledger writer. Run scripts only while the dashboard is idle.
12. **Never sign an owner approval over an RPC-supplied digest alone.** `signOwnerApproval` recomputes `approvalDigest` locally and refuses on a mismatch. If the digest layout in `AgentGuard.sol` changes, change `localApprovalDigest` in the same commit.
13. **Contract changes ship with their artifact.**
    - Edit `contracts/AgentGuard.sol`, run `pnpm guard:compile`, and commit the regenerated `src/lib/guard/AgentGuard.json` with it.
    - A deployed guard is immutable: a change takes effect only after `pnpm guard:deploy --force`, and funds left in the old guard need an owner-signed call to recover.

## How to work

- Read the files a change touches and trace the flow end to end before editing. The security path is only about 100 lines; read all of it.
- Write readable code: one statement per line, named helpers, and prettier formatting on touched files. Judges review this source.
- Prefer the smallest diff that holds. Add no dependency when viem, zod or the platform already covers the need.
- For UI, use GodUI components through the GodUI MCP (`pnpm godui:check`) before hand-building. Lucide is the icon set.
- Commit messages: imperative, one concern each.

## Definition of done

- [ ] `pnpm test`, `pnpm typecheck` and `pnpm build` pass. Paste the output; don't paraphrase it.
- [ ] Any new policy branch has a test that fails without it.
- [ ] Hard rules 1–13 still hold.
- [ ] Docs updated if behaviour changed.
- [ ] Any on-chain claim is backed by a BaseScan-verifiable hash at `https://sepolia.basescan.org/tx/<hash>`.
