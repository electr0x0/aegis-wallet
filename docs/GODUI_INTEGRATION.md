# GodUI integration

This workspace follows the [GodUI installation guide](https://godui.design/docs/installation), the [core component catalog](https://godui.design/docs/components), and the [Lab catalog](https://godui.design/docs/lab). Source was installed with shadcn 4.22.1 on October 19, 2026. Components are owned local source, not hand-built imitations of GodUI. Local project instruction documents are excluded from the published repository.

## Workspace MCP

- `.codex/config.toml` registers the pinned `@godui/mcp@0.1.0` stdio server for this project only. No global configuration was changed.
- `.mcp.json` supplies the equivalent portable project configuration for compatible MCP clients.
- The same exact server package is a development dependency, locked in `package-lock.json`.
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

| Application surface                         | Official components                          |
| ------------------------------------------- | -------------------------------------------- |
| Actions and navigation                      | GodUI Button, Tooltip                        |
| Workspace navigation                       | GodUI Sidebar, SidebarProvider, SidebarTrigger, SidebarRail, mobile Sheet |
| Portfolio / guardrails / evidence views     | GodUI Tabs and animated indicator            |
| Policy editor                               | GodUI Input, Textarea, Slider, Switch        |
| Allocation and autonomous budget            | GodUI Progress                               |
| Loading states                              | GodUI Skeleton                               |
| Transaction review                          | GodUI Alert Dialog + Lab Hold Confirm Button |
| Metric tiles and wallet / proposal surfaces | Lab Spotlight Card                           |
| Metric values and evidence count            | Lab Number Ticker                            |
| Demo scenarios                              | Lab Prompt Suggestions                       |
| Natural language input                      | Lab Prompt Composer                          |
| Agent output and audit evidence             | Lab Agent Timeline / Agent Step              |

Core files are in `src/components/ui`, Lab files in `src/components/godui`, and application compositions in `src/components/wallet`. Shared GodUI motion hooks are in `src/hooks`.

## Theme and local adaptations

`src/app/godui-theme.css` retains the registry theme, spring easings, animations and reduced-motion tokens. `globals.css` imports it and supplies the Aegis dark-green semantic palette and responsive layout. The root HTML element uses `.dark`. A top-level `MotionConfig reducedMotion="user"` honors the user's reduced-motion preference for Lab components.

The Prompt Composer adds `allowAttachments` and `maxLength` props. Attachments are disabled because this wallet accepts text intents only; the input is bounded to the backend's 4,000-character limit. No stop-generation button is shown for on-chain operations because a submitted transaction cannot be cancelled by stopping a browser request.

Tier 2 approval opens a GodUI review dialog with the full destination, amount, gas estimate and policy reasons. The Lab control requires a one-second pointer or keyboard hold before requesting approval. Releasing early cancels the hold. Server-side simulation, approval uniqueness and deterministic policy remain authoritative.

The Hold Confirm Button has two local safety adaptations: only the primary pointer button starts a hold, and losing keyboard focus cancels an in-progress hold.

The registry's shared `cn` adapter is implemented locally with `clsx` and Tailwind Merge v3 for Tailwind v4 compatibility. Application styles target wrapper classes rather than globally overriding component buttons or form elements.

The sidebar is installed from `https://godui.design/r/sidebar.json`. It expands to labeled navigation, collapses to icons, supports Ctrl/Cmd+B, and uses a Sheet below 768px. Selecting a mobile navigation item closes the Sheet. The main dashboard flexes into all remaining viewport space; it has no fixed maximum width or rail offset.

Geist Sans and Geist Mono are bundled locally with `geist` and loaded through Next.js in the root layout, matching GodUI's brand-font instructions. Both the theme utility tokens and application CSS use the Geist variables.

Application icons use per-icon imports from `@svg-animated-icons/react` ([library](https://svg-animated-icons.vercel.app/)). The `wallet/icons.tsx` adapter supplies sizing and decorative accessibility defaults. Sidebar toggle and Sheet close controls use the same library. CSS disables icon animations for reduced-motion users. GodUI Lab's internal control glyphs remain part of the upstream component source.

## Validation

For a production check alongside a running development server, set `AEGIS_BUILD_DIR=.next-verify` before `pnpm build` to isolate Next.js output. The default output directory remains `.next`.

Run `pnpm test`, `pnpm typecheck`, and `pnpm build`. The 32-test suite includes policy, execution concurrency, local API access, approval review/cancellation/confirmation, and text-only composer behavior. Browser checks cover the desktop and narrow layouts, tabs, live metrics, policy controls, and blocked-request audit rendering. Live portfolio reads and blocked security scenarios can be exercised without funding; live approval/broadcast requires funded Base Sepolia assets.
