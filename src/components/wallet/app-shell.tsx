"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { MotionConfig } from "framer-motion";
import {
  ArrowUpRight,
  ShieldCheck,
  Terminal,
  X,
} from "@/components/wallet/icons";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./app-sidebar";
import { SecurityBanner } from "./security-banner";
import { useWallet } from "./wallet-provider";

// Shared chrome for every route: sidebar, header and the cross-page alerts.
export function AppShell({ children }: { children: ReactNode }) {
  const chat = usePathname() === "/agent";
  const { trip, setTrip, snapshot, notice, setNotice } = useWallet();
  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider delayDuration={250}>
        <SidebarProvider className="app-shell">
          <AppSidebar />
          <main className="app-main" data-view={chat ? "chat" : "dashboard"}>
            <header className="app-header">
              <div className="header-identity">
                <SidebarTrigger />
                <nav aria-label="Breadcrumb" className="breadcrumb">
                  <span>Workspace</span>
                  <span aria-hidden="true">/</span>
                  <span aria-current="page">
                    {chat ? "Agent chat" : "Agent control"}
                  </span>
                </nav>
              </div>
              <div className="network-status">
                <span>
                  <i /> Base Sepolia
                </span>
                <span className="network-badge">TESTNET</span>
              </div>
            </header>
            {/* On /agent the blocked reply already sits in the conversation. */}
            {trip && !chat && (
              <SecurityBanner trip={trip} onDismiss={() => setTrip(null)} />
            )}
            {snapshot?.error && (
              <div className="setup-banner" role="status">
                <Terminal size={18} />
                <div>
                  <b>Wallet connection needs attention</b>
                  <p>{snapshot.error}</p>
                </div>
                <code>pnpm setup-wallets</code>
              </div>
            )}
            {notice && (
              <div className="notice-banner" role="status">
                <ShieldCheck size={17} className="shrink-0" />
                <p>{notice}</p>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Dismiss notification"
                  onClick={() => setNotice("")}
                >
                  <X size={15} />
                </Button>
              </div>
            )}
            {children}
            {!chat && (
              <footer className="app-footer">
                <span>
                  <ShieldCheck size={13} />
                  Trust the boundaries. Verify the execution.
                </span>
                <a
                  href="https://sepolia.basescan.org"
                  target="_blank"
                  rel="noreferrer"
                >
                  BASE SEPOLIA · 84532
                  <ArrowUpRight size={12} />
                </a>
              </footer>
            )}
          </main>
        </SidebarProvider>
      </TooltipProvider>
    </MotionConfig>
  );
}
