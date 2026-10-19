"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { MessageSquare, X } from "lucide-react";
import { MotionConfig } from "framer-motion";
import { AccountSwitcher } from "@/components/AccountSwitcher";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./app-sidebar";
import { IntentStudio } from "./intent-studio";
import { TelemetryRibbon } from "./telemetry-ribbon";
import { VIEW_LABELS } from "./console-views";
import { SecurityBanner } from "./security-banner";
import { useWallet } from "./wallet-provider";

export function AppShell({ children }: { children: ReactNode }) {
  const { tab, trip, setTrip, snapshot, notice, setNotice } = useWallet();
  const [mobile, setMobile] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  useEffect(() => {
    const query = matchMedia("(max-width: 1023px)");
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider delayDuration={250}>
        <SidebarProvider
          className="app-shell"
          style={{ "--sidebar-width": "14rem" } as CSSProperties}
        >
          <AppSidebar />
          <main className="app-main">
            <header className="app-header">
              <div className="header-identity">
                <SidebarTrigger />
                <nav aria-label="Breadcrumb" className="breadcrumb">
                  <span>Workspace</span>
                  <span aria-hidden="true">/</span>
                  <span aria-current="page">
                    {VIEW_LABELS[tab] ?? VIEW_LABELS.command}
                  </span>
                </nav>
              </div>
              <div className="header-actions">
                <Button
                  variant="outline"
                  size="sm"
                  className="mobile-copilot-toggle"
                  onClick={() => setCopilotOpen(true)}
                >
                  <MessageSquare size={15} />
                  Intent Studio
                </Button>
                <AccountSwitcher />
              </div>
            </header>
            <div className="console-workspace">
              <section className="center-stage" aria-label="Center workspace">
                <TelemetryRibbon />
                <div className="stage-scroll" key={tab}>
                  {snapshot?.error && (
                    <div className="setup-banner" role="status">
                      <b>Wallet connection needs attention</b>
                      <p>{snapshot.error}</p>
                    </div>
                  )}
                  {snapshot?.activeAccount &&
                    snapshot.activeAccount.id !== "master" && (
                      <details className="funding-notice">
                        <summary>
                          Onboarding gas:{" "}
                          {snapshot.activeAccount.drip.status
                            .toLowerCase()
                            .replaceAll("_", " ")}
                        </summary>
                        <p>{snapshot.activeAccount.drip.reason}</p>
                        {snapshot.activeAccount.drip.txHash && (
                          <a
                            className="transaction-link"
                            href={`https://sepolia.basescan.org/tx/${snapshot.activeAccount.drip.txHash}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            View funding receipt
                          </a>
                        )}
                        <p className="break-all">
                          Funding address: {snapshot.activeAccount.address}
                        </p>
                      </details>
                    )}
                  {trip && (
                    <SecurityBanner
                      trip={trip}
                      onDismiss={() => setTrip(null)}
                    />
                  )}
                  {notice && (
                    <div className="notice-banner" role="status">
                      <p>{notice}</p>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Dismiss notification"
                        onClick={() => setNotice("")}
                      >
                        <X size={14} />
                      </Button>
                    </div>
                  )}
                  {children}
                </div>
              </section>
              {!mobile && <IntentStudio />}
            </div>
          </main>
          {mobile && (
            <Sheet open={copilotOpen} onOpenChange={setCopilotOpen}>
              <SheetContent
                side="right"
                showCloseButton={false}
                className="mobile-copilot-sheet"
              >
                <SheetHeader className="sr-only">
                  <SheetTitle>Intent Studio</SheetTitle>
                  <SheetDescription>
                    Autonomous agent conversation and transaction approvals.
                  </SheetDescription>
                </SheetHeader>
                <IntentStudio onClose={() => setCopilotOpen(false)} />
              </SheetContent>
            </Sheet>
          )}
        </SidebarProvider>
      </TooltipProvider>
    </MotionConfig>
  );
}
