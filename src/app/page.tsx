"use client";
import {
  CommandCenter,
  EvidenceView,
  PortfolioView,
} from "@/components/wallet/console-views";
import { PolicyControls } from "@/components/wallet/policy-controls";
import { useWallet } from "@/components/wallet/wallet-provider";
import { TreasuryView } from "@/components/wallet/treasury-view";
import { PolicyLab } from "@/components/wallet/policy-lab";
import { ProofView } from "@/components/wallet/proof-view";
export default function Home() {
  const { tab, snapshot, busy, sessionLocked, savePolicy } = useWallet();
  if (tab === "proof") return <ProofView key={snapshot?.activeAccount?.id} />;
  if (tab === "treasury")
    return <TreasuryView key={snapshot?.activeAccount?.id} />;
  if (tab === "policy")
    return (
      <div className="space-y-4">
        <PolicyControls
          key={snapshot?.activeAccount?.id}
          policy={snapshot?.policy ?? null}
          busy={busy || sessionLocked}
          save={savePolicy}
        />
        <PolicyLab key={`lab-${snapshot?.activeAccount?.id}`} />
      </div>
    );
  if (tab === "portfolio")
    return <PortfolioView key={snapshot?.activeAccount?.id} />;
  if (tab === "evidence") return <EvidenceView />;
  return <CommandCenter />;
}
