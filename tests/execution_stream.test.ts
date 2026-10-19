import { describe, expect, it } from "vitest";
import { readExecutionStream } from "../src/components/wallet/read-execution";
import type { ExecutionProgress } from "../src/lib/agent/progress";

function response(chunks: string[]) {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks)
          controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    }),
  );
}
describe("Execution progress stream", () => {
  it("parses partial chunks and exposes only recorded progress before the final result", async () => {
    const events: ExecutionProgress[] = [];
    const result = await readExecutionStream(
      response([
        '{"type":"progress","event":{"stage":"policy","status":"success",',
        '"message":"Tier 0 read"}}\n{"type":"result","result":{"summary":"Read complete"}}\n',
      ]),
      (event) => events.push(event),
    );
    expect(events).toEqual([
      { stage: "policy", status: "success", message: "Tier 0 read" },
    ]);
    expect(result).toEqual({ summary: "Read complete" });
  });
  it("does not invent completion after a disconnected stream or server failure", async () => {
    await expect(
      readExecutionStream(
        response([
          '{"type":"progress","event":{"stage":"broadcast","status":"submitted","message":"Hash persisted"}}\n',
        ]),
        () => {},
      ),
    ).rejects.toThrow("Check Evidence before retrying");
    await expect(
      readExecutionStream(
        response(['{"type":"error","error":"Incorrect PIN"}\n']),
        () => {},
      ),
    ).rejects.toThrow("Incorrect PIN");
  });
});
