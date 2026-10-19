"use client";

import Link from "next/link";
import { Expand, Terminal } from "@/components/wallet/icons";
import { AgentChat } from "./agent-chat";

// Dashboard view of the shared conversation; /agent shows the same thread full height.
export function IntentStudio() {
  return (
    <section className="panel intent-studio" aria-labelledby="studio-title">
      <div className="panel-heading">
        <h2 id="studio-title">
          <Terminal size={17} /> Intent studio
        </h2>
        <Link href="/agent" className="panel-link">
          <Expand size={14} /> Open full chat
        </Link>
      </div>
      <AgentChat />
    </section>
  );
}
