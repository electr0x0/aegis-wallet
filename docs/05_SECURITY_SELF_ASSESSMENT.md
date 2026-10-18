# 05 — Security self-assessment

## Boundary and permission model

Tier 0 reads require no signing. Tier 1 writes require successful simulation and bounded policy. Tier 2 proposals are persisted and require an explicit local operator click. Human approval cannot override blacklist, simulation or gas failures. Private keys stay in `.env.local` and server-side viem account objects; API responses and exports contain only public addresses. No browser extension or client-side signing key is used.

The intended deployment is a trusted local workstation with one operator and one Node process. Loopback binding, host validation and exact-origin mutation checks reduce remote access and browser CSRF risk. There is no production authentication, MFA or cryptographic user confirmation; the HITL control is a local UI confirmation. Do not expose the service publicly.

## Known-risk and mitigation matrix

| Risk | Mitigation | Residual limitation |
|---|---|---|
| Smart contract vulnerability | Canonical fixed token addresses, constrained ABI, simulation and boolean-return checks | Simulation cannot prove future contract behavior or prevent state changes between call and mining |
| Oracle manipulation | Disclosed fixed reference valuation, no external pricing input | Fixed prices are stale by design and unsuitable for mainnet risk limits |
| Prompt injection | Deterministic schema, allowlisted tool kinds, hard policy checks, original prompt retention and suspicious-input heuristics | Heuristics do not detect every phrasing; amount and address policy remain the actual boundary |
| RPC downtime / dishonest RPC | Timeouts, explicit errors, chain ID checks, no simulated success | Single RPC remains a trust and availability dependency |
| Session/signing key compromise | Key only on server, ignored secret files, no output of key | Local malware or process compromise can steal the full key; no HSM or limited on-chain session key |
| Duplicate execution / concurrency | Global single-process mutex, durable reservations, single-use proposals | Multiple processes are unsupported; crash during broadcast requires manual nonce reconciliation |
| Gas changes | Fresh estimation and gas-price ceiling at evaluation | Fee market can move after the check; gas ceiling is not a guarantee of final total fee |
| Stale approval | Revalidate policy, chain and simulation immediately before broadcast | No cryptographic user signature or proposal expiry |
| Ledger alteration | Atomic replacement and application append-only events | Local files are editable and not tamper-evident; immutable external storage is needed for formal audit |
| USD rounding | Small bounded reference-valued transactions, boundary tests | Floating-point policy valuation is unsuitable for high-value financial accounting |
| Browser CSRF / remote access | Same-origin mutations and loopback-only host | Trusted local applications can invoke the API; no multi-user authentication |

## Verification

Vitest covers whitelisted micro-transfers, exact thresholds, oversized transfers, unknown destinations, blacklist precedence, adversarial instructions, simulation failures, gas ceilings, rolling spend, human mode and invalid numeric values. Typecheck/build validate server/client integration. These are not a formal audit and do not prove live testnet execution; real transaction evidence is generated only after funding and confirmation.

## Evidence handling

Each attempted write records time, original intent, tier, status, risk score, simulation result, USD reference value and any transaction hash. Submitted hashes are persisted before awaiting a receipt. `BROADCASTING` without a hash signals an uncertain submission; inspect wallet history before retrying. `SUBMITTED` with a hash may be pending even if receipt polling timed out. `CONFIRMED` requires a successful actual receipt. Export includes all statuses and never invents proof of execution.
