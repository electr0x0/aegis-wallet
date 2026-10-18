"use client";

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
import { Wallet, SlidersHorizontal, FileText, ShieldCheck } from "./icons";

export function AppSidebar({
  active,
  onNavigate,
}: {
  active: string;
  onNavigate: (view: string) => void;
}) {
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <Sidebar collapsible="icon" aria-label="Workspace navigation">
      <SidebarHeader className="h-[85px] justify-center border-b border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg" tooltip="AegisWallet home">
              <a href="/">
                <ShieldCheck size={24} className="text-primary" />
                <span className="sidebar-brand">
                  aegis<span>wallet</span>
                </span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {[
                { id: "portfolio", label: "Portfolio", Icon: Wallet },
                { id: "policy", label: "Guardrails", Icon: SlidersHorizontal },
                { id: "evidence", label: "Evidence", Icon: FileText },
              ].map(({ id, label, Icon }) => (
                <SidebarMenuItem key={id}>
                  <SidebarMenuButton
                    isActive={active === id}
                    tooltip={label}
                    onClick={() => {
                      onNavigate(id);
                      if (isMobile) setOpenMobile(false);
                    }}
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
