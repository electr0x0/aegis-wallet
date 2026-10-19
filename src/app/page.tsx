"use client";
import {
  CommandCenter,
  EvidenceView,
  PortfolioView,
} from "@/components/wallet/console-views";
import { PolicyControls } from "@/components/wallet/policy-controls";
import { useWallet } from "@/components/wallet/wallet-provider";
export default function Home() {
  const { tab, snapshot, busy, sessionLocked, savePolicy } = useWallet();
  if (tab === "policy")
    return (
      <PolicyControls
        key={snapshot?.activeAccount?.id}
        policy={snapshot?.policy ?? null}
        busy={busy || sessionLocked}
        save={savePolicy}
      />
    );
  if (tab === "portfolio")
    return <PortfolioView key={snapshot?.activeAccount?.id} />;
  if (tab === "evidence") return <EvidenceView />;
  return <CommandCenter />;
}
