# AegisWallet

Local operator dashboard for a server-signed Base Sepolia wallet. Next.js 15, TypeScript, Tailwind v4, GodUI and GodUI Lab, Lucide, viem and a persistent JSON ledger.

```powershell
npm install
npm run setup-wallets
npm run dev
```

Open http://127.0.0.1:3000. The setup command creates `.env.local` without printing the signing key. Fund the printed **agent address** with Base Sepolia ETH and USDC, then rerun setup to execute two real evidence transactions. It preserves existing configuration and avoids repeating recorded setup operations. No fake balances or transaction hashes are generated. The generated vault key is retained as `VAULT_PRIVATE_KEY` in `.env.local`; the application signs only with the agent key. You can instead configure your own `VAULT_ADDRESS`.

Optional configuration: `BASE_SEPOLIA_RPC_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL`. Demo prompts work without an LLM. Other requests use a bounded server-side tool-calling planner when configured. ETH is valued at a disclosed fixed $2,500 reference; this is not a live price oracle. No exchange swaps or slippage-bearing routes are implemented; wrapping uses canonical 1:1 WETH.

```powershell
npm test
npm run typecheck
npm run build
npm start
```

The service binds to loopback and accepts only local, same-origin mutations. It is a single-operator, single-Node-process prototype. Do not expose it through a public proxy or launch multiple writers against the ledger. Restart the dev server after editing environment variables. Back up `data/audit_log.json` and `.env.local` privately. Neither is committed.

Approval re-runs simulation and current policy; a hard block cannot be overridden. All submissions reserve their spend before broadcast, and unknown outcomes are retained for manual reconciliation instead of automatic retry. A receipt timeout may leave a submitted hash in the evidence trail; inspect it on BaseScan. A crash between broadcast and hash persistence requires wallet/nonce reconciliation.

Deliverables: [architecture](docs/01_TECHNICAL_DOCUMENTATION.md), [security assessment](docs/05_SECURITY_SELF_ASSESSMENT.md), automated policy tests, setup CLI, and JSON/Markdown evidence export from the dashboard. Real evidence requires funded testnet execution; an unfunded checkout is not a completed on-chain submission.

## GodUI design system

The dashboard uses official GodUI and GodUI Lab source components. Workspace MCP configuration, component mapping, installation commands, and local adaptations are documented in [GodUI integration](docs/GODUI_INTEGRATION.md). Run `npm run godui:check` to verify the installed MCP server.
