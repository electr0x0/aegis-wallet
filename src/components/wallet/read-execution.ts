import type { ExecutionProgress } from "@/lib/agent/progress";

export async function readExecutionStream(
  response: Response,
  onProgress: (event: ExecutionProgress) => void,
) {
  if (!response.body) throw new Error("Execution stream unavailable");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "",
    result: unknown,
    finished = false;
  function consume(line: string) {
    if (!line.trim()) return;
    const message = JSON.parse(line);
    if (message.type === "progress") onProgress(message.event);
    if (message.type === "error") throw new Error(message.error);
    if (message.type === "result") {
      result = message.result;
      finished = true;
    }
  }
  try {
    while (true) {
      const chunk = await reader.read();
      buffered += decoder.decode(chunk.value, { stream: !chunk.done });
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) consume(line);
      if (chunk.done) {
        consume(buffered);
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
  if (!finished)
    throw new Error(
      "Connection ended before a final result. Check Evidence before retrying.",
    );
  return result;
}
