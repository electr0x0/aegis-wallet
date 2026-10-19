import { hexToBytes, type Hex } from "viem";

export type BytecodeScan = {
  isContract: boolean;
  size: number;
  delegatecall: boolean;
  selfdestruct: boolean;
  minimalProxy: boolean;
  flags: string[];
};

const PUSH1 = 0x60;
const PUSH32 = 0x7f;
const DELEGATECALL = 0xf4;
const SELFDESTRUCT = 0xff;
// EIP-1167 runtime prefix; the 20-byte implementation address follows it.
const MINIMAL_PROXY_PREFIX = "363d3d373d3d3d363d73";
// EIP-7702 delegation designator: an EOA whose calls run another contract's code.
const EIP7702_PREFIX = "ef0100";

// Solidity appends CBOR metadata whose last two bytes give its length. Its hash
// bytes are data, not code, and would otherwise produce false opcode matches.
function withoutMetadata(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 2) return bytes;
  const length = (bytes[bytes.length - 2] << 8) | bytes[bytes.length - 1];
  const start = bytes.length - 2 - length;
  const isCborMap = start >= 0 && bytes[start] >= 0xa1 && bytes[start] <= 0xa5;
  return isCborMap ? bytes.subarray(0, start) : bytes;
}

function findOpcodes(bytes: Uint8Array) {
  let delegatecall = false;
  let selfdestruct = false;
  for (let i = 0; i < bytes.length; i++) {
    const op = bytes[i];
    // PUSH1..PUSH32 carry 1..32 bytes of immediate data, which are not opcodes.
    if (op >= PUSH1 && op <= PUSH32) i += op - PUSH1 + 1;
    else if (op === DELEGATECALL) delegatecall = true;
    else if (op === SELFDESTRUCT) selfdestruct = true;
  }
  return { delegatecall, selfdestruct };
}

// Static heuristics only: this is not a contract security audit.
export function scanBytecode(code: Hex | undefined): BytecodeScan {
  const hex = (code ?? "0x").toLowerCase() as Hex;
  const bytes = hexToBytes(hex);
  if (bytes.length === 0) {
    return {
      isContract: false,
      size: 0,
      delegatecall: false,
      selfdestruct: false,
      minimalProxy: false,
      flags: ["No bytecode: externally owned account or undeployed address"],
    };
  }

  if (bytes.length === 23 && hex.slice(2).startsWith(EIP7702_PREFIX)) {
    return {
      isContract: true,
      size: bytes.length,
      delegatecall: true,
      selfdestruct: false,
      minimalProxy: false,
      flags: [`EIP-7702 delegated EOA: executes code at 0x${hex.slice(8)}`],
    };
  }

  const { delegatecall, selfdestruct } = findOpcodes(withoutMetadata(bytes));
  const minimalProxy = hex.slice(2).startsWith(MINIMAL_PROXY_PREFIX);
  const flags: string[] = [];
  if (minimalProxy) {
    const offset = 2 + MINIMAL_PROXY_PREFIX.length;
    const target = `0x${hex.slice(offset, offset + 40)}`;
    flags.push(`EIP-1167 minimal proxy forwarding every call to ${target}`);
  }
  if (delegatecall) {
    flags.push(
      "DELEGATECALL: runs external code with this contract's storage and balance",
    );
  }
  if (selfdestruct) {
    flags.push("SELFDESTRUCT: contract can sweep its ETH balance");
  }
  return {
    isContract: true,
    size: bytes.length,
    delegatecall,
    selfdestruct,
    minimalProxy,
    flags,
  };
}
