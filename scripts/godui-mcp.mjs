import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "node:path";

// Exercise the installed, pinned server over actual MCP stdio (no IDE restart needed).
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve("node_modules/@godui/mcp/dist/index.js")],
  stderr: "inherit",
});
const client = new Client({
  name: "aegis-godui-verification",
  version: "1.0.0",
});
try {
  await client.connect(transport);
  if (!process.argv[2]) {
    const result = await client.listTools();
    console.log(JSON.stringify(result, null, 2));
  } else {
    const result = await client.callTool({
      name: process.argv[2],
      arguments: JSON.parse(process.argv[3] || "{}"),
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.isError) process.exitCode = 1;
  }
} finally {
  await client.close();
}
