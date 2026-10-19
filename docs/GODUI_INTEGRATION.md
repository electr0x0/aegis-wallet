# GodUI integration

This workspace follows the [GodUI installation guide](https://godui.design/docs/installation), the [core component catalog](https://godui.design/docs/components), and the [Lab catalog](https://godui.design/docs/lab). Source was installed with shadcn 4.22.1 on October 19, 2026. Components are owned local source, not hand-built imitations of GodUI. Local project instruction documents are excluded from the published repository.

## Workspace MCP

- `.codex/config.toml` registers the pinned `@godui/mcp@0.1.0` stdio server for this project only. No global configuration was changed.
- `.mcp.json` supplies the equivalent portable project configuration for compatible MCP clients.
- The same exact server package is a development dependency, locked in `pnpm-lock.yaml`.
- `codex mcp get godui --json` confirms the project server is enabled. Reload the Codex MCP connection or reopen the project to make newly registered tools available to a new agent session.
- `pnpm godui:check` independently connects to the installed server over MCP stdio and lists its tools. It does not load `.env.local` or transmit wallet configuration.

Verified tools: `list_components`, `search_components`, and `get_component`. The live catalog was queried for AI components, and Number Ticker's full source was retrieved through `get_component`.

```powershell
pnpm godui:check
node scripts/godui-mcp.mjs list_components '{"category":"AI"}'
node scripts/godui-mcp.mjs get_component '{"name":"number-ticker"}'
```

Codex project MCP configuration follows the [official project configuration documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli). Project settings load for trusted workspaces; restarting is a client activation step, not a component installation requirement.

## Registry configuration

`components.json` registers both namespaces:

```json
{
  "@godui": "https://godui.design/r/{name}.json",
  "@godui-lab": "https://godui.design/r/lab/{name}.json"
}
```

Future additions use `pnpm dlx shadcn@4.22.1 add @godui/<name>` or `pnpm dlx shadcn@4.22.1 add @godui-lab/<name>`. The one-time shadcn installer was removed from application dependencies after installation. Review registry updates before overwriting local adaptations.

## Component map

| Application surface                     | Official components                                                                                  |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Actions and navigation                  | GodUI Button, Tooltip                                                                                |
| Workspace navigation                    | GodUI Sidebar, SidebarProvider, SidebarTrigger, SidebarRail, mobile Sheet                            |
| Four center views                       | GodUI Sidebar navigation; no duplicate body tabs                                                     |
| Workspace breadcrumb                    | Lab Breadcrumbs with animated path changes                                                           |
| Portfolio, allocation and policy panels | Lab Bento Grid / Bento Card and Spotlight Card                                                       |
| Policy editor                           | GodUI Input, Textarea, Slider, Switch                                                                |
| Allocation and autonomous budget        | GodUI Progress                                                                                       |
| Loading states                          | GodUI Skeleton                                                                                       |
| Transaction review                      | GodUI Alert Dialog + Lab Hold Confirm Button                                                         |
| Portfolio / policy / evidence actions   | GodUI Button, Input, Progress and theme tokens                                                       |
| Live telemetry                          | Compact ribbon with GodUI Progress                                                                   |
| Demo scenarios                          | Lab Prompt Suggestions (compact list, tier badges, disabled reasons) in a GodUI Collapsible          |
| Natural language input                  | Lab Prompt Composer                                                                                  |
| Permanent Intent Studio                 | GodUI Conversation Thread / Conversation Message; mobile Sheet                                       |
| Audit evidence                          | Lab Filter Bar (tier, status and pre-flight facets), native accessible table, GodUI Button and Input |
| Recent events and execution progress    | Lab Agent Timeline / Agent Step with collapsible details                                             |
| Reference portfolio total               | Lab Number Ticker, initialized at the actual returned value                                          |
| Provisioning risk presets               | GodUI Radio Group and animated Radio Group Item                                                      |

Core files are in `src/components/ui`, Lab files in `src/components/godui`, and application compositions in `src/components/wallet`. Shared GodUI motion hooks are in `src/hooks`.

Five wallet surfaces have no GodUI counterpart and are composed from the theme tokens and the components above: `agent-reply.tsx` (turns each API result into a plain-language outcome, with the raw JSON behind "Technical details"), `security-banner.tsx` (guardrail-triggered alert), `guard-panel.tsx` (AgentGuard contract, session key, expiry and per-asset caps), `runway-tile.tsx` (reserve runway against the policy floor) and `ledger-badges.tsx` (sealed-ledger verification and per-entry seal).

## Theme and local adaptations

`src/app/godui-theme.css` retains the registry theme, spring easings, animations and reduced-motion tokens. `globals.css` imports it and supplies the Aegis light "white ledger" palette and responsive layout: ink for hierarchy, one emerald accent for in-policy states, and amber (human approval) and red (blocked) reserved for tier semantics. The app renders in light mode; the root HTML element has no `.dark` class. A top-level `MotionConfig reducedMotion="user"` honors the user's reduced-motion preference for Lab components.

The Prompt Composer adds `allowAttachments` and `maxLength` props. Attachments are disabled because this wallet accepts text intents only; the input is bounded to the backend's 4,000-character limit. No stop-generation button is shown for on-chain operations because a submitted transaction cannot be cancelled by stopping a browser request.

The console refactor queried the GodUI MCP for table, conversation and navigation components before composing the views. The table registry lookup returned HTTP 404, so Execution Evidence uses an accessible native table with GodUI controls. `console.css` locks the root to `100dvh`, gives each pane independent scrolling, and pins the Lab Prompt Composer and the collapsible scenario list below the conversation. The right panel is 420px (460px at XL) and can expand to 640px without replacing the center view. Below 1024px the copilot uses a Sheet. The 56px telemetry ribbon replaces metric cards, and sidebar navigation replaces the body tabs. `/agent` now redirects to the shared console.

The follow-up composition pass uses the MCP-returned Bento Grid/Card, Filter Bar, Breadcrumbs and Radio Group source directly. Existing Agent Timeline/Step now render both recent audit events and actual execution progress. Held and submitted events use the timeline's pending state; they never acquire a successful checkmark before an actual successful event. Reference amounts initialize Number Ticker at the returned value rather than counting through invented intermediate balances. The evidence facets combine selections within a facet with OR and across facets with AND; Clear all resets them. Export still includes all account events.

Local adaptations use the shared `cn` adapter for predictable class overrides in Bento Grid/Card, Spotlight Card, Conversation Thread and Prompt Composer. Conversation Message supports full-width rich content and uses a block body for nested execution cards. Prompt Suggestions exposes compact chip and list options and a trailing `badge` slot, which the scenarios use for their tier. Filter Bar adds explicit accessible facet/option labels and multi-select semantics. These replace deep CSS overrides: `console.css` decreased from 931 to 239 lines, retaining viewport/pane geometry, account-header responsiveness, shared domain copy styles and native evidence-table formatting. The registry components supply surface styling and motion.

Tier 2 approval opens a GodUI review dialog with the full destination, amount, gas estimate and policy reasons. The Lab control requires a one-second pointer or keyboard hold before requesting approval. Releasing early cancels the hold. Server-side simulation, approval uniqueness and deterministic policy remain authoritative.

The Hold Confirm Button has two local safety adaptations: only the primary pointer button starts a hold, and losing keyboard focus cancels an in-progress hold.

The registry's shared `cn` adapter is implemented locally with `clsx` and Tailwind Merge v3 for Tailwind v4 compatibility. Application styles target wrapper classes rather than globally overriding component buttons or form elements.

The sidebar is installed from `https://godui.design/r/sidebar.json`. It expands to labeled navigation, collapses to icons, supports Ctrl/Cmd+B, and uses a Sheet below 768px. Selecting a mobile navigation item closes the Sheet. The main dashboard flexes into all remaining viewport space; it has no fixed maximum width or rail offset.

Geist Sans and Geist Mono are bundled locally with `geist` and loaded through Next.js in the root layout, matching GodUI's brand-font instructions. Both the theme utility tokens and application CSS use the Geist variables.

Application icons are [Lucide](https://lucide.dev) (`lucide-react`), as AGENTS.md requires. Wallet components import them through the `wallet/icons.tsx` adapter, which sets one 1.75 stroke weight and decorative `aria-hidden` defaults; console and account UI import `lucide-react` directly. Sidebar rows use 16px icons, the size the collapsed 32px rail is built for. The brand mark (`src/app/icon.svg`, also the favicon) is a shield split white and emerald; `app-sidebar.tsx` draws the same paths inline. The sidebar footer shows the live AgentGuard session state. The sidebar colour comes from the `--sidebar` token, which the sliding surface paints: never set a background on `sidebar-inner`, because the inner keeps its full width while the panel collapses and would snap instead of sliding. GodUI Lab's internal control glyphs remain part of the upstream component source.

## Validation

Account provisioning and PIN confirmation use the official GodUI Dialog, Dropdown Menu, Input and Button source. Dialog and Dropdown Menu source was retrieved through the GodUI MCP for this addition. The approval hold control remains the existing Lab Hold Confirm Button, followed by the server-verified PIN step. The account switcher uses Lucide icons in accordance with AGENTS.md.

For a production check alongside a running development server, set `AEGIS_BUILD_DIR=.next-verify` before `pnpm build` to isolate Next.js output. The default output directory remains `.next`.

Run `pnpm test`, `pnpm typecheck`, and `pnpm build`. The Vitest suite includes policy, execution concurrency, local API access, approval review/cancellation/confirmation, text-only composer behavior, funded-asset scenario selection and streamed progress parsing. Browser checks covered all four center views, retained conversation/draft across navigation, evidence tier filters, the 640px expansion, and Clear Thread. At 1280×800 and 390×844 the root document matched the viewport; mobile Intent Studio kept its composer pinned to the Sheet bottom. Live portfolio reads can be exercised without funding; live approval/broadcast requires funded Base Sepolia assets.
