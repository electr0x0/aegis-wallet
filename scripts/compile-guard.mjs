// Compiles contracts/AgentGuard.sol with the pinned solc npm package and writes the
// { abi, bytecode } artifact that src/lib/chain.ts and the guard scripts import.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import solc from "solc";
import { CONTRACT, ROOT, SOURCE, standardJsonInput } from "./guard-source.mjs";

const OUTPUT = join(ROOT, "src/lib/guard/AgentGuard.json");

const input = standardJsonInput(["abi", "evm.bytecode.object"]);

const output = JSON.parse(solc.compile(JSON.stringify(input)));
const diagnostics = output.errors ?? [];
for (const diagnostic of diagnostics)
  console.error(diagnostic.formattedMessage);
if (diagnostics.some((d) => d.severity === "error")) process.exit(1);

const contract = output.contracts[SOURCE][CONTRACT];
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
