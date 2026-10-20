# Validation — 20 October 2026

Local environment: Node v26.7.0, pnpm 11.25.0, Next.js 15.5.28. The committed CI targets Node 24. No new transaction, funding, deployment or approval was signed during these checks.

## Final submission source review

The final repository review used a separate copy containing only public source files and the committed default policy. No `.env.local`, account storage, audit ledger, local agent instructions, MCP configuration or submission binaries were copied. The collaborator's documentation reorganization in `67dc916` was retained; it changes no application source.

Actual output from `pnpm test` in the main checkout:

```text
 Test Files  22 passed (22)
      Tests  357 passed (357)
   Start at  21:26:46
   Duration  9.69s (import 70%, environment 15%, tests 13%, transform 1%)
```

The isolated source copy passed a frozen offline install using the local package cache, and a TypeScript check before any generated build files existed:

```text
Lockfile is up to date, resolution step is skipped
Packages: +341
Done in 9.8s using pnpm v11.25.0
$ tsc --noEmit
```

The isolated production build ran before wallet setup, with wallet/model credentials removed from the process environment and no `.env.local`:

```text
$ next build
   ▲ Next.js 15.5.28
 ✓ Compiled successfully in 18.7s
   Linting and checking validity of types ...
   Collecting page data ...
 ✓ Generating static pages (6/6)
   Finalizing page optimization ...
   Collecting build traces ...
```

The documented fresh-wallet setup then created new throwaway keys, printed only their public addresses and reported funding required. No funding or broadcast occurred. An isolated production server on loopback port 3339 returned HTTP 200 for the dashboard and `/api/agent`; the latter returned actual ETH, WETH and USDC balances of `0`. The test server was stopped afterward. These are HTTP/API smoke checks, not a new visual browser review or an on-chain payment demonstration.

Independent verification of the unchanged submitted account JSON, using the published expected signer and guard, returned:

```text
88 entries, chain intact within the export, 4 gaps, 88 signatures valid, 8/8 receipts match
```

`--offline` also passed its seal checks and explicitly reported receipts not checked. No EAS checkpoint was selected for this account export. These results do not replace the separate historical 47-entry/15-receipt run in Deliverable 06.

The production dependency audit returned:

```text
No known vulnerabilities found
```

Repository review also checked relative documentation links/anchors, ignored private/submission paths, local-only file preservation, credential-literal candidates outside synthetic test fixtures, formatting and Git whitespace. Local instructions and design-system configuration remain available on disk but are removed from the published tree. UI source and tests remain included. No runtime code, contract artifact, lockfile or operator policy was changed by this documentation polish.

## Earlier automated checks

Actual output from an earlier combined test run, before the final 357-test snapshot above:

```text
$ vitest run "--silent"

 Test Files  22 passed (22)
      Tests  356 passed (356)
   Start at  03:42:18
   Duration  8.27s (import 69%, tests 15%, environment 14%, transform 1%)
```

TypeScript completed with exit code 0:

```text
$ tsc --noEmit
```

Production build completed with exit code 0 (`AEGIS_BUILD_DIR=.next-verify`). A sandbox EPERM creating a generated types directory was resolved by rerunning the build with workspace write permission; no source or security setting was weakened.

```text
 ✓ Compiled successfully in 4.3s
   Linting and checking validity of types ...
   Collecting page data ...
 ✓ Generating static pages (6/6)
   Finalizing page optimization ...
   Collecting build traces ...

Route (app)                                 Size  First Load JS
┌ ○ /                                    18.2 kB         255 kB
├ ○ /_not-found                            996 B         104 kB
├ ○ /agent                                 128 B         104 kB
├ ƒ /api/agent                             128 B         104 kB
└ ○ /icon.svg                                0 B            0 B
```

Prettier reported:

```text
Checking formatting...
All matched files use Prettier code style!
```

## Browser verification

The production dashboard ran on an isolated loopback port; the operator's existing server was not stopped. Desktop verification used 1600×1000; mobile used 390×844. The mobile document width was 390px and Intent Studio opened in its Sheet.

- Treasury preview read real balances, showed the saved runway floor as the binding constraint and returned no eligible surplus. It did not sign or create a proposal.
- The policy comparison simulated a real 1 USDC transfer. Both current and hypothetical policies held it for the reserve-runway rule; only the current policy added its always-ask reason. No policy was changed and no execution evidence was written.
- Judge proof verified the current account export: **80 signatures valid, 8/8 unique receipts match, four account-filter gaps**. The full local ledger has 84 sealed entries; the account export omits four other-account entries. This is not a claim of complete history or EAS coverage.
- The current policy still requires approval for every write. The live readiness view marks this for review; it does not silently loosen it.

The eight existing transactions checked by the verifier are linked here so the receipt claim can be checked independently. This list supplements the separate operator run in Deliverable 06; it does not invent or merge private ledger history.

| Existing transaction | Base Sepolia receipt                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1                    | [0xe9d9af…3b442c](https://sepolia.basescan.org/tx/0xe9d9afeaab638900273bf0b5bc5f08b3fef4cc5448489d7fdc506c576d3b442c) |
| 2                    | [0x8f7aed…3ad7fb](https://sepolia.basescan.org/tx/0x8f7aed2ff974fe9397ab43afc016c0de952f7d36dec4fd092a4cbf8be73ad7fb) |
| 3                    | [0x906451…c7ea1a](https://sepolia.basescan.org/tx/0x906451f67f9f2ed348b5c7bd25df4a4ffc7fa5e9b4febc9d9381239291c7ea1a) |
| 4                    | [0x80db24…1a633d](https://sepolia.basescan.org/tx/0x80db248e4bf1a8e29047e93b7f1858d73d415266d9c476ffb698142ab91a633d) |
| 5                    | [0xd8e1a0…72d083](https://sepolia.basescan.org/tx/0xd8e1a0aa32456c4fa0bcf99bed43627a5545528c065b5f9c1fbc1f335772d083) |
| 6                    | [0xaf60e0…409e02](https://sepolia.basescan.org/tx/0xaf60e02e9d610afb3a7515573e7d4eb3568c2096e091e9d26c7a8e0381409e02) |
| 7                    | [0xd5f39f…0a50f5](https://sepolia.basescan.org/tx/0xd5f39fd895e216b1b4387f9af0d77599af0f2e0f1f4c0c1149b5014afc0a50f5) |
| 8                    | [0xaf99a7…332ba1](https://sepolia.basescan.org/tx/0xaf99a70ec4d5d38eea0f43a5a539ae9d097e0abe397d16f3c4c6bc8f8d332ba1) |

EAS coverage is tested with clearly marked synthetic fixtures for matching prefixes, tail deletion, unanchored suffixes, wrong schema/attester, expiration, revocation, filtered exports and unavailable reads. No matching live full-ledger checkpoint is claimed for this local run. The final overall verifier result requires every selected check, including any selected checkpoint, to pass.

## Submission handoff

Use [the judge walkthrough](JUDGE_WALKTHROUGH.md) for the review sequence and [the submission folder](https://drive.google.com/drive/folders/1Cw41nMcZb73bek-7lEANnuIzOpuMheBS?usp=sharing) for the presentation, recorded product video, PDFs and evidence. Production limitations, including co-located owner keys, fixed pricing, legacy floating-point gate valuation and process-local storage, remain documented in the security assessment.

![Production Judge proof workspace](screenshots/judge-proof.png)
