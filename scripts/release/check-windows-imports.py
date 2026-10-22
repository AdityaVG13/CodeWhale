import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys


MACHINES = {0x014C: "windows-x86", 0x8664: "windows-x64", 0xAA64: "windows-arm64"}


def pe_identity(data):
    if len(data) < 64 or data[:2] != b"MZ":
        raise ValueError("expected a Windows PE executable")
    offset = struct.unpack_from("<I", data, 60)[0]
    if offset + 24 > len(data) or data[offset:offset + 4] != b"PE\0\0":
        raise ValueError("invalid PE signature or COFF header")
    machine, _, _, _, _, optional_size, characteristics = struct.unpack_from("<HHIIIHH", data, offset + 4)
    if machine not in MACHINES or not characteristics & 0x0002:
        raise ValueError("unsupported machine or non-executable PE image")
    optional = offset + 24
    if optional_size < 2 or optional + optional_size > len(data):
        raise ValueError("truncated PE optional header")
    magic = struct.unpack_from("<H", data, optional)[0]
    if magic == 0x010B:
        count_offset, directories_offset = 92, 96
    elif magic == 0x020B:
        count_offset, directories_offset = 108, 112
    else:
        raise ValueError("unsupported PE optional-header format")
    if count_offset + 4 > optional_size:
        raise ValueError("truncated PE data-directory count")
    count = struct.unpack_from("<I", data, optional + count_offset)[0]
    if directories_offset + count * 8 > optional_size:
        raise ValueError("truncated PE data-directory table")
    delay_rva, delay_size = (0, 0)
    if count > 13:
        delay_rva, delay_size = struct.unpack_from("<II", data, optional + directories_offset + 13 * 8)
    return MACHINES[machine], delay_rva, delay_size


def parse_imports(raw):
    if not re.search(r"file format (coff|pei)-(x86-64|arm64|aarch64|i386)", raw, flags=re.I):
        raise ValueError("unrecognized Windows object-dumper format")
    if "The Import Tables:" not in raw:
        raise ValueError("no readable static import table")
    table = raw.split("The Import Tables:", 1)[1]
    table = re.split(r"^(?:The )?(?:Export|Delay Import) Tables?:", table, maxsplit=1, flags=re.M)[0]
    imports = set()
    dll = None
    for line in table.splitlines():
        if not line.strip():
            continue
        if re.fullmatch(r"\s*lookup [0-9a-fA-F]+ time [0-9a-fA-F]+ fwd [0-9a-fA-F]+ name [0-9a-fA-F]+ addr [0-9a-fA-F]+\s*", line):
            dll = None
            continue
        if dll and re.fullmatch(r"\s*Hint/Ord\s+Name\s*", line):
            continue
        match = re.fullmatch(r"\s*DLL Name: (\S+)\s*", line)
        if match:
            dll = match[1].lower()
            continue
        match = re.fullmatch(r"\s+(\d+)\s+(\S+)\s*", line)
        if dll and match:
            imports.add((dll, match[2]))
        elif dll and re.fullmatch(r"\s+\d+\s*", line):
            imports.add((dll, "#" + line.strip()))
        else:
            raise ValueError(f"unrecognized import-table row: {line.strip()}")
    if not imports:
        raise ValueError("zero static imports parsed")
    return imports


def main():
    parser = argparse.ArgumentParser(description="Qualify PE static imports against a reviewed OS and architecture baseline.")
    parser.add_argument("binaries", nargs="+", type=Path)
    parser.add_argument("--baseline", type=Path, default=Path(__file__).with_name("windows-import-floor.json"))
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--objdump")
    parser.add_argument("--expected-machine", choices=tuple(MACHINES.values()))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    receipts = []
    try:
        baseline = json.loads(args.baseline.read_text(encoding="utf-8"))
        profiles = baseline["profiles"]
        objdump = args.objdump or shutil.which("llvm-objdump")
        if not objdump:
            candidate = Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "LLVM/bin/llvm-objdump.exe"
            if candidate.is_file():
                objdump = str(candidate)
        if not objdump:
            raise ValueError("llvm-objdump is required; no import check was performed")
    except (OSError, ValueError, KeyError) as error:
        (args.output / "receipt.json").write_text(json.dumps({"result": "FAIL", "error": str(error)}, indent=2) + "\n", encoding="utf-8")
        print(f"Windows import check failed: {error}", file=sys.stderr)
        return 1
    for index, binary in enumerate(args.binaries):
        receipt = {"binary": str(binary), "result": "FAIL"}
        receipts.append(receipt)
        try:
            data = binary.read_bytes()
            receipt["sha256"] = hashlib.sha256(data).hexdigest()
            machine, delay_rva, delay_size = pe_identity(data)
            receipt.update(machine=machine, delayImportRva=delay_rva, delayImportSize=delay_size)
            result = subprocess.run([objdump, "-p", str(binary)], check=False, capture_output=True, text=True)
            (args.output / f"{index}-{binary.name}.imports.txt").write_text(result.stdout, encoding="utf-8")
            (args.output / f"{index}-{binary.name}.stderr.txt").write_text(result.stderr, encoding="utf-8")
            receipt["objdumpExitCode"] = result.returncode
            if result.returncode:
                raise ValueError("object dumper failed; raw output is retained")
            if args.expected_machine and machine != args.expected_machine:
                raise ValueError(f"expected {args.expected_machine}, got {machine}")
            if delay_rva or delay_size:
                raise ValueError("delay-load imports require explicit qualification; no table was silently excluded")
            imports = parse_imports(result.stdout)
            profile = profiles.get(machine)
            if not profile:
                raise ValueError(f"no reviewed baseline profile for {machine}")
            receipt.update(baselineFloor=profile["floor"], qualification=profile["qualification"])
            allowed = {(dll.lower(), symbol) for dll, symbols in profile["imports"].items() for symbol in symbols}
            unknown = sorted(imports - allowed)
            receipt.update(imports=sorted(imports), unqualified=unknown)
            if profile["qualification"]["result"] != "PASS":
                raise ValueError(f"baseline profile is not qualified for {machine}")
            if unknown:
                raise ValueError(f"{len(unknown)} import pairs are unqualified")
            receipt.update(result="PASS", floor=profile["floor"])
        except (OSError, ValueError, KeyError, struct.error) as error:
            receipt["error"] = str(error)
        finally:
            (args.output / "receipt.json").write_text(json.dumps(receipts, indent=2) + "\n", encoding="utf-8")
        print(f"{receipt['result']}: {binary}: {len(receipt.get('imports', []))} static imports: {receipt.get('error', receipt.get('floor', 'unqualified profile'))}")
        for library, symbol in receipt.get("unqualified", []):
            print(f"  {library}!{symbol}")
    return int(any(receipt["result"] != "PASS" for receipt in receipts))


if __name__ == "__main__":
    sys.exit(main())
