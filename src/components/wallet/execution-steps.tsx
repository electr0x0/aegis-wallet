"use client";
import type { ExecutionProgress } from "@/lib/agent/progress";
import { AgentStep, AgentTimeline } from "@/components/godui/agent-timeline";
const labels = {
  policy: "1. Policy Check",
  simulation: "2. EVM Simulation",
  broadcast: "3. Base Sepolia Broadcast",
};
export function ExecutionSteps({ steps }: { steps: ExecutionProgress[] }) {
  if (!steps.length) return null;
  return (
    <AgentTimeline className="my-3" aria-label="Recorded execution steps">
      {steps.map((step, index) => (
        <AgentStep
          key={step.stage}
          title={<span className="text-xs">{labels[step.stage]}</span>}
          status={
            step.status === "failed"
              ? "error"
              : step.status === "held" || step.status === "submitted"
                ? "pending"
                : step.status
          }
          meta={
            <span
              className={
                step.status === "held" || step.status === "submitted"
                  ? "text-[var(--amber)]"
                  : ""
              }
            >
              {step.status}
            </span>
          }
          defaultOpen
          last={index === steps.length - 1}
        >
          <p className="[overflow-wrap:anywhere]">{step.message}</p>
          {step.txHash && (
            <a
              href={`https://sepolia.basescan.org/tx/${step.txHash}`}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block text-primary hover:underline"
            >
              View BaseScan receipt ↗
            </a>
          )}
        </AgentStep>
      ))}
    </AgentTimeline>
  );
}
