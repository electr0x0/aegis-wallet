# Judge walkthrough and evidence handoff

The strongest demonstration is a useful financial goal followed by proof of its boundaries. Do not substitute a claimed score for observable behavior. Task completion is 40%, security/compliance 30%, innovation/interaction 30%; on-chain exploration can earn up to five bonus points.

## Before the session

1. Run `pnpm test`, `pnpm typecheck`, `pnpm build` and `pnpm godui:check`.
2. Start a single dashboard process. Keep operator scripts idle while the dashboard is active: JSON ledger locking is process-local.
3. Open Judge proof. Review each non-ready item. Provider keys, funding, guard configuration/expiry and the active policy are operator prerequisites, not features the checklist fixes automatically.
4. Keep your real evidence JSON and its expected signer beside `docs/06_EXECUTION_EVIDENCE.md`. The private ledger is intentionally absent from Git. A friend's documented receipts may come from a different ledger; request that matching export instead of combining or inventing history.
5. Have the full ledger matching a previously published EAS checkpoint if demonstrating anchored prefix coverage. An account-only export cannot prove completeness. Never treat a transaction hash as an attestation UID.
6. Record or present only the exact submitted commit. The presentation deck and optional video remain separate submission artifacts; this walkthrough is not the deck or a video.

## Six-minute operator demonstration

| Time      | Action                                                                                                                                              | What a judge can verify                                                                                                                                             |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:40 | Open Judge proof and explain guard mode, planner configuration and the live gas reserve.                                                            | Actual prerequisites and limitations are visible. No fabricated balance or provider-health claim.                                                                   |
| 0:40–1:20 | Inspect the portfolio in Intent Studio.                                                                                                             | Read-only Tier 0 plus actual tool progress.                                                                                                                         |
| 1:20–2:20 | Treasury mandates: set a maximum and gas reserve, preview the sweep, inspect the limiting constraint. Execute only after reviewing the real amount. | Integer reserve/budget/runway calculation; vault destination; normal policy gate and real receipt or honest hold/block. A zero-surplus result is valid.             |
| 2:20–3:10 | Pay an invoice from the inbox; compare a registered vendor with a changed-address invoice.                                                          | Model extraction is constrained by source text; vendor mismatch is a final hard block. No model or invoice can rewrite the vendor book.                             |
| 3:10–3:50 | Review a pending Tier 2 payment. Inspect full recipient and current policy, then approve with the demo PIN only if the transaction is intended.     | Human step-up, new simulation and in guard mode an owner authorization verified by the contract. Use an already published real receipt if the wallet is not funded. |
| 3:50–4:30 | Policy what-if lab: compare a small real transfer under current versus hypothetical limits.                                                         | Explainable tier changes without saving settings or signing. Hard blocks and contract limits survive a looser cap.                                                  |
| 4:30–5:00 | Show local Pause, describe its PIN requirement and contrast its scope with owner on-chain revocation. Do not toggle it just for visual effect.      | Local control is clearly distinguished from the documented on-chain reverted attack and revocation receipts.                                                        |
| 5:00–6:00 | Import evidence in Judge proof. Confirm expected signer, verify receipts and optionally the matching full-ledger EAS UID, then export the report.   | Seals, receipts, incomplete exports, prefix coverage and unanchored tails are distinguished. Open a returned BaseScan link.                                         |

## Evidence rules

- Never turn test output into on-chain evidence. All automated fixtures are synthetic and marked as such.
- A successful offline seal check is not a successful receipt check.
- A signed account export can omit entries. A full ledger can still lose its tail unless checked against a trusted checkpoint.
- An EAS checkpoint proves the selected prefix; newer history is unanchored. The signer may create another checkpoint, so publish the UID independently.
- Every pending or unknown broadcast remains reserved. Check BaseScan manually; do not replay it to get a cleaner demo.
- The public demo PIN and environment-isolated keys are prototype controls. The owner key is not a hardware wallet, and this is not production custody.

## How the additions strengthen the rubric

Task completion gains a reserve-aware treasury goal that uses available assets. Security gains revalidated single-use previews, PIN-protected local interruption and an independent evidence/checkpoint checker. Interaction gains transparent what-if policy comparisons, a live readiness view and reviewer exports. Existing invoice verification, contract enforcement, attack evidence and bounded LLM planning remain central. Winning still depends on the final presentation, a funded/configured demo and evidence that matches the submitted run.
