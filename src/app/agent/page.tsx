import type { Metadata } from "next";
import { AgentChat, ChatContextRail } from "@/components/wallet/agent-chat";
import { MessageSquare } from "@/components/wallet/icons";

export const metadata: Metadata = { title: "Agent chat · AegisWallet" };

export default function AgentPage() {
  return (
    <div className="chat-page">
      <section className="panel chat-panel" aria-labelledby="chat-title">
        <div className="panel-heading">
          <h2 id="chat-title">
            <MessageSquare size={17} /> Conversation
          </h2>
          <span className="status-tag">
            <i /> POLICY-GATED
          </span>
        </div>
        <AgentChat />
      </section>
      <ChatContextRail />
    </div>
  );
}
