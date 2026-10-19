"use client";

import Link from "next/link";
import { Target, FileCheck2 } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  ScanLine,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  SlidersHorizontal,
  Wallet,
} from "./icons";
import { timeLeft } from "./guard-panel";
import { useWallet } from "./wallet-provider";

const DASHBOARD_VIEWS = [
  { id: "command", label: "Command Center", Icon: ScanLine },
  { id: "portfolio", label: "Portfolio & Runway", Icon: Wallet },
  { id: "treasury", label: "Treasury mandates", Icon: Target },
  { id: "policy", label: "Guardrails & Policy", Icon: SlidersHorizontal },
  { id: "evidence", label: "Execution Evidence", Icon: ScrollText },
  { id: "proof", label: "Judge proof", Icon: FileCheck2 },
];

// The right half of the shield in src/app/icon.svg, drawn over the white whole.
const SHIELD =
  "M112 108Q112 80 140 80H372Q400 80 400 108V256C400 352 336 408 256 440C176 408 112 352 112 256Z";
const SHIELD_RIGHT = "M256 80H372Q400 80 400 108V256C400 352 336 408 256 440Z";

function BrandMark() {
  return (
    <span className="brand-mark">
      <svg viewBox="0 0 512 512" aria-hidden="true">
        <path d={SHIELD} fill="#ffffff" />
        <path d={SHIELD_RIGHT} fill="#17a374" />
      </svg>
    </span>
  );
}

type GuardState = "loading" | "active" | "expired" | "unknown" | "off";

const GUARD_ICON = {
  loading: ShieldCheck,
  active: ShieldCheck,
  expired: ShieldAlert,
  unknown: ShieldAlert,
  off: ShieldOff,
};

// Footer status: what actually protects the funds right now, from live data.
function GuardSessionStatus({ onSelect }: { onSelect: () => void }) {
  const { snapshot } = useWallet();
  const guard = snapshot?.guard;
  const remaining = guard ? timeLeft(guard.sessionExpiry) : null;
  let state: GuardState = "off";
  if (!snapshot) state = "loading";
  else if (guard) state = remaining ? "active" : "expired";
  else if (snapshot.portfolio?.mode === "guard") state = "unknown";
  const title = {
    loading: "Checking AgentGuard",
    active: "AgentGuard active",
    expired: "Session key expired",
    unknown: "Guard unreadable",
    off: "No on-chain guard",
  }[state];
  const detail = {
    loading: "Base Sepolia",
    active: `Session key, ${remaining}`,
    expired: "Renew to resume autonomy",
    unknown: "Contract status read failed",
    off: "EOA mode, policy only",
  }[state];
  const Icon = GUARD_ICON[state];
  return (
    <SidebarMenuButton
      size="lg"
      tooltip={`${title}: ${detail}`}
      data-guard={state}
      onClick={onSelect}
    >
      <span className="guard-status-mark">
        <Icon size={16} />
      </span>
      <span className="guard-status-text">
        <span>{title}</span>
        <small>{detail}</small>
      </span>
    </SidebarMenuButton>
  );
}

export function AppSidebar() {
  const { isMobile, setOpenMobile } = useSidebar();
  const { tab, setTab } = useWallet();
  const pathname = usePathname();
  const router = useRouter();
  const close = () => {
    if (isMobile) setOpenMobile(false);
  };
  const openView = (id: string) => {
    setTab(id);
    close();
    if (pathname !== "/") router.push("/");
  };
  return (
    <Sidebar collapsible="icon" aria-label="Workspace navigation">
      <SidebarHeader className="h-16 justify-center border-b border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              size="lg"
              tooltip="AegisWallet home"
              className="sidebar-home"
            >
              <Link href="/" onClick={close}>
                <BrandMark />
                <span className="sidebar-brand">
                  Aegis<span>Wallet</span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {DASHBOARD_VIEWS.map(({ id, label, Icon }) => (
                <SidebarMenuItem key={id}>
                  <SidebarMenuButton
                    isActive={pathname === "/" && tab === id}
                    tooltip={label}
                    onClick={() => openView(id)}
                  >
                    <Icon size={16} />
                    <span>{label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <GuardSessionStatus onSelect={() => openView("portfolio")} />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
