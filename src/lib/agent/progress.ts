import { AsyncLocalStorage } from "node:async_hooks";

export type ExecutionProgress = {
  stage: "extraction" | "policy" | "simulation" | "broadcast";
  status: "running" | "success" | "held" | "failed" | "submitted";
  message: string;
  txHash?: string;
  start?: boolean;
};
const observers = new AsyncLocalStorage<(event: ExecutionProgress) => void>();
export function withExecutionProgress<T>(
  observer: (event: ExecutionProgress) => void,
  work: () => T,
): T {
  return observers.run(observer, work);
}
// Observability must never interrupt an already-authorized transaction.
export function reportProgress(event: ExecutionProgress) {
  try {
    observers.getStore()?.(event);
  } catch {
    /* Disconnected UI; execution and audit persistence continue. */
  }
}
