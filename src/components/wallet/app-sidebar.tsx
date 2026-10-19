"use client";

import Link from "next/link";
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
  Wallet,
  SlidersHorizontal,
  FileText,
  ScanLine,
  ShieldCheck,
} from "./icons";
import { useWallet } from "./wallet-provider";

const DASHBOARD_VIEWS = [
  { id: "command", label: "Command Center", Icon: ScanLine },
  { id: "portfolio", label: "Portfolio & Runway", Icon: Wallet },
  { id: "policy", label: "Guardrails & Policy", Icon: SlidersHorizontal },
  { id: "evidence", label: "Execution Evidence", Icon: FileText },
];

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
              className="hover:bg-transparent"
            >
              <Link href="/" onClick={close}>
                <span className="brand-mark">
                  <ShieldCheck size={17} />
                </span>
                <span className="sidebar-brand">
                  aegis<span>wallet</span>
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
                    <Icon size={20} />
                    <span>{label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border py-4">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Local operator · Base Sepolia"
              className="pointer-events-none"
              asChild
            >
              <div>
                <span className="operator-avatar">AS</span>
                <span className="flex flex-col gap-0.5">
                  <span>Local operator</span>
                  <span className="text-xs text-muted-foreground">
                    Base Sepolia testnet
                  </span>
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
