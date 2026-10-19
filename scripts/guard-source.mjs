// The single compiler input for AgentGuard. guard:compile builds the artifact from it and
// guard:verify publishes it, so the verified source and settings are the ones that were deployed.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SOURCE = "contracts/AgentGuard.sol";
export const CONTRACT = "AgentGuard";

// Git stores the source with LF endings, but a Windows checkout can hand us CRLF. The metadata
// hash at the end of the bytecode covers the exact source bytes, so normalise before compiling.
function guardSource() {
  return readFileSync(join(ROOT, SOURCE), "utf8").replace(/\r\n/g, "\n");
}

export function standardJsonInput(outputs) {
  return {
    language: "Solidity",
    sources: { [SOURCE]: { content: guardSource() } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // Pinned so the bytecode only uses opcodes Base Sepolia is known to support.
      evmVersion: "cancun",
      outputSelection: { [SOURCE]: { [CONTRACT]: outputs } },
    },
  };
}
