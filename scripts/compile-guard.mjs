// Compiles contracts/AgentGuard.sol with the pinned solc npm package and writes the
// { abi, bytecode } artifact that src/lib/chain.ts and the guard scripts import.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = "contracts/AgentGuard.sol";
const OUTPUT = join(ROOT, "src/lib/guard/AgentGuard.json");

const input = {
  language: "Solidity",
  sources: { [SOURCE]: { content: readFileSync(join(ROOT, SOURCE), "utf8") } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    // Pinned so the bytecode only uses opcodes Base Sepolia is known to support.
    evmVersion: "cancun",
    outputSelection: {
      [SOURCE]: { AgentGuard: ["abi", "evm.bytecode.object"] },
    },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));
const diagnostics = output.errors ?? [];
for (const diagnostic of diagnostics)
  console.error(diagnostic.formattedMessage);
if (diagnostics.some((d) => d.severity === "error")) process.exit(1);

const contract = output.contracts[SOURCE].AgentGuard;
const bytecode = `0x${contract.evm.bytecode.object}`;
mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(
  OUTPUT,
  `${JSON.stringify({ abi: contract.abi, bytecode }, null, 2)}\n`,
);

const size = (bytecode.length - 2) / 2;
console.log(
  `AgentGuard compiled with solc ${solc.version()}: ${size} bytes of creation code`,
);
console.log(`Wrote ${OUTPUT}`);
