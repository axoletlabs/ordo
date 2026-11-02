#!/usr/bin/env python3
"""Build a universal APK by combining ABI-specific APK native libraries."""

import argparse
import hashlib
from pathlib import Path
import zipfile


ABIS = ("armeabi-v7a", "arm64-v8a", "x86", "x86_64")


def read_apk(path: Path, abi: str):
    with zipfile.ZipFile(path) as apk:
        infos = [info for info in apk.infolist() if not info.is_dir()]
        libraries = [info for info in infos if info.filename.startswith("lib/")]
        found_abis = {info.filename.split("/", 2)[1] for info in libraries}
        if found_abis != {abi}:
            raise ValueError(f"{path}: expected native libraries for {abi}, found {sorted(found_abis)}")

        common = {
            info.filename: hashlib.sha256(apk.read(info)).digest()
            for info in infos
            if not info.filename.startswith("lib/")
            and not info.filename.startswith("META-INF/")
        }
        if not libraries:
            raise ValueError(f"{path}: no native libraries found for {abi}")
        return infos, common, {info.filename: apk.read(info) for info in libraries}


def main():
    parser = argparse.ArgumentParser()
    for abi in ABIS:
        parser.add_argument(f"--{abi}", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    entries = {}
    common_entries = None
    base_infos = None
    for abi in ABIS:
        path = getattr(args, abi.replace("-", "_"))
        infos, common, libraries = read_apk(path, abi)
        if common_entries is None:
            common_entries = common
            base_infos = infos
        elif common != common_entries:
            changed = sorted(set(common) | set(common_entries))
            changed = [name for name in changed if common.get(name) != common_entries.get(name)]
            raise ValueError(f"{path}: non-library APK contents differ: {changed[:20]}")
        entries.update(libraries)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(args.output, "w") as merged:
        with zipfile.ZipFile(args.arm64_v8a) as base:
            for info in base_infos:
                name = info.filename
                if name.startswith("lib/"):
                    continue
                # The base APK signature becomes invalid when its native
                # libraries change. apksigner will add a fresh signature.
                if name.startswith("META-INF/"):
                    continue
                merged.writestr(info, base.read(info))
        for name, data in entries.items():
            source_abi = name.split("/", 2)[1]
            source_path = getattr(args, source_abi.replace("-", "_"))
            with zipfile.ZipFile(source_path) as source:
                merged.writestr(source.getinfo(name), data)

    with zipfile.ZipFile(args.output) as merged:
        found_abis = {
            info.filename.split("/", 2)[1]
            for info in merged.infolist()
            if info.filename.startswith("lib/")
        }
    if found_abis != set(ABIS):
        raise ValueError(f"universal output ABI set is wrong: {sorted(found_abis)}")
    print(f"Created {args.output} with native libraries for {', '.join(ABIS)}")


if __name__ == "__main__":
    main()
