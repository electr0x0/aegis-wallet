# Judge walkthrough and evidence handoff

Start with the [submission folder](https://drive.google.com/drive/folders/1Cw41nMcZb73bek-7lEANnuIzOpuMheBS?usp=sharing): presentation, product video, documentation PDFs, signed evidence JSON and verifier report. This repository is the source-code deliverable. The upload's artifact numbering differs from the competition numbering; use the file titles.

## Review without funding a wallet

1. Watch the product recording, then compare the proposal, policy decision, simulation, human approval and returned receipt. A recorded run is historical; current balances and session state can differ.
2. Read [01: architecture and execution algorithm](01_TECHNICAL_DOCUMENTATION.md), then [05: permission tiers and known risks](05_SECURITY_SELF_ASSESSMENT.md). The model proposes; code authorizes; AgentGuard limits delegated signing authority.
3. Open the [reverted direct-key attack](https://sepolia.basescan.org/tx/0xaea1b30e3af54cfc5a7ff85ae1d687a16d94c7692990f8004b3f47e9a7ad6122) and [owner-approved payment](https://sepolia.basescan.org/tx/0x0f8d7803692337695608ca8fb853d6b329ade3e66c6d4eb32b6a7c85e381b2fd). [06](06_EXECUTION_EVIDENCE.md) describes their exact roles and the other historical receipts.
4. Follow [the unfunded setup](SETUP.md#2-start-without-funding-or-an-llm) to explore the console, or run `pnpm test`, `pnpm typecheck` and `pnpm build` without keys. The test suite includes an in-process EVM; it does not claim live-chain execution.
5. Independently verify the submitted export as described next. Neither verification path needs a browser wallet, private key, funding or LLM provider.

## Verify the submitted export

Download `04_Execution_Evidence.json` from the submission folder into a local `deliverables/` directory. If the downloaded filename or directory differs, pass that actual path instead.

```powershell
pnpm verify:evidence "deliverables/04_Execution_Evidence.json" --signer 0xE1f4D11f3170Bd994379eA5f7443d826BC3ABd9F --guard 0xe05aec8cd8cd122f0988ba835670f64171453a31
```

The expected signer and guard above come from the published project record, rather than the imported file. The command reads Base Sepolia RPC and never signs or writes state. The CLI does not auto-load `.env.local`; set `BASE_SEPOLIA_RPC_URL` in the shell if the public default is unavailable.

For seals only, add `--offline`. Offline verification cannot establish receipt status. Alternatively, open **Judge proof**, import the JSON, confirm the expected signer and guard, enable receipt checks, and download the report. Browser imports are limited to 2 MB, 1,000 entries and 50 distinct online transactions; use the CLI for larger files.

### Keep the two evidence scopes separate

| Dataset                                               | Recorded verification                                                       | Meaning / limitation                                                                                                                                                                                                      |
| ----------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Historical operator run in `06_EXECUTION_EVIDENCE.md` | 47 entries, 47 signatures, 15/15 receipts                                   | Documents deployment, direct-key revert, Tier 1, Tier 2, owner revocation/renewal and EAS. Its EAS checkpoint covers only the first 33 sealed entries. Reproducing that ledger result needs its matching full ledger.     |
| Submitted master-account export                       | 88 entries, 88 valid signatures, 8/8 unique receipts; 4 account-filter gaps | A separate account-filtered export. Gaps omit other-account entries; this is not a complete-history claim. The package's verifier report records the exact result. No matching EAS checkpoint is claimed for this export. |

Different counts reflect different recordings, not interchangeable evidence. A hash may appear in multiple status entries; receipt counts are unique transactions. Never merge runs, silently fill gaps or use an account export to claim full-ledger EAS coverage. For an EAS check, supply the matching full ledger and the attestation **UID**, not the transaction hash. A matching checkpoint proves the selected prefix; newer entries remain unanchored.

## Optional live operator demonstration

Only run this sequence with your own funded/configured wallet. Follow [the guard setup](SETUP.md#4-fund-your-own-base-sepolia-guard-demo), review readiness in Judge proof, and confirm current budgets, runway and session expiry first. The public historical guard is not a shared judge sandbox.

| Time      | Action                                                                          | Observable result                                                                               |
| --------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 0:00–0:40 | Open Judge proof and explain custody mode, provider configuration and agent gas | Real prerequisites; configured model names do not establish provider health                     |
| 0:40–1:20 | Inspect the portfolio in Intent Studio                                          | Tier 0 reads, no signing                                                                        |
| 1:20–2:20 | Preview a treasury mandate; inspect the limiting constraint before executing    | Available-asset selection, gas reserve, budget and runway; a zero-surplus result is valid       |
| 2:20–3:10 | Compare a registered-vendor invoice with a changed-address invoice              | Source-grounded extraction and a final vendor/payee mismatch block                              |
| 3:10–3:50 | Review a real held Tier 2 proposal, then approve only if intended               | Fresh PIN, new simulation/policy check and, in guard mode, owner authorization checked on-chain |
| 3:50–4:30 | Compare current and hypothetical policy in the what-if lab                      | Explainable changes without saving limits or signing                                            |
| 4:30–5:00 | Explain local pause versus owner on-chain revocation                            | Application interruption and contract revocation have different scopes                          |
| 5:00–6:00 | Verify the export and open its returned BaseScan links                          | Seals, receipts, account-filter gaps and prefix coverage are distinguished                      |

Use the shorter [recording script](DEMO_SCRIPT.md) for a video of at most five minutes. Do not reproduce the six-minute live walkthrough as the video.

## Boundaries worth checking

- Blacklist, failed simulation, wrong chain, gas ceiling, local pause and vendor mismatch are final hard blocks. Approval re-runs checks; it cannot override them.
- The model cannot sign, approve, replace the stored original prompt, run arbitrary contract calls, or perform swaps/yield/bridging.
- A reserved or unknown broadcast must be reconciled, not retried to obtain a cleaner demo.
- The six-digit public demo PIN and environment-held owner key are prototype controls. There is no HSM, independent owner device or production tenant isolation.
- EOA-mode accounts have no contract guard. Guard mode still leaves the agent's gas EOA exposed to its key holder.
- No local ledger or account secrets are committed. An unfunded checkout has no invented balances, hashes or history.
