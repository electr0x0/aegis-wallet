"use client";
import type { ExecutionProgress } from "@/lib/agent/progress";
const labels = {
  policy: "1. Policy Check",
  simulation: "2. EVM Simulation",
  broadcast: "3. Base Sepolia Broadcast",
};
export function ExecutionSteps({ steps }: { steps: ExecutionProgress[] }) {
  if (!steps.length) return null;
  return (
    <ol className="execution-steps" aria-label="Recorded execution steps">
      {steps.map((step) => (
        <li key={step.stage} data-status={step.status}>
          <span className="step-dot" />
          <div>
            <strong>{labels[step.stage]}</strong>
            <p>{step.message}</p>
            {step.txHash && (
              <a
                href={`https://sepolia.basescan.org/tx/${step.txHash}`}
                target="_blank"
                rel="noreferrer"
              >
                View BaseScan receipt ↗
              </a>
            )}
          </div>
          <span className="step-status">{step.status}</span>
        </li>
      ))}
    </ol>
  );
}
