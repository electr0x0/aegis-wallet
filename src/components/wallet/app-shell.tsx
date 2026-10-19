"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { MessageSquare, X } from "lucide-react";
import { MotionConfig } from "framer-motion";
import { AccountSwitcher } from "@/components/AccountSwitcher";
import { Breadcrumbs } from "@/components/godui/breadcrumbs";
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
import { ExecutionControl } from "./execution-control";
import { VIEW_LABELS } from "./console-views";
import { SecurityBanner } from "./security-banner";
import { useWallet } from "./wallet-provider";

export function AppShell({ children }: { children: ReactNode }) {
  const { tab, setTab, trip, setTrip, snapshot, notice, setNotice } =
    useWallet();
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
                <Breadcrumbs
                  className="min-w-0"
                  items={[
                    { label: "Workspace", href: "/" },
                    { label: VIEW_LABELS[tab] ?? VIEW_LABELS.command },
                  ]}
                  onNavigate={() => setTab("command")}
                />
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
                    <div
                      className="mb-4 rounded-lg border border-[var(--amber-line)] bg-[var(--amber-tint)] p-3 text-xs leading-relaxed [overflow-wrap:anywhere]"
                      role="status"
                    >
                      <b>Wallet connection needs attention</b>
                      <p>{snapshot.error}</p>
                    </div>
                  )}
                  {snapshot?.activeAccount &&
                    snapshot.activeAccount.id !== "master" && (
                      <details className="mb-4 rounded-lg border bg-accent p-3 text-xs leading-relaxed [overflow-wrap:anywhere]">
                        <summary className="cursor-pointer">
                          Onboarding gas:{" "}
                          {snapshot.activeAccount.drip.status
                            .toLowerCase()
                            .replaceAll("_", " ")}
                        </summary>
                        <p>{snapshot.activeAccount.drip.reason}</p>
                        {snapshot.activeAccount.drip.txHash && (
                          <a
                            className="inline-flex text-primary hover:underline"
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
                    <div
                      className="mb-4 flex items-start justify-between gap-2 rounded-lg border bg-accent p-3 text-xs leading-relaxed [overflow-wrap:anywhere]"
                      role="status"
                    >
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
                  {(tab === "command" || tab === "policy") && (
                    <ExecutionControl />
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
