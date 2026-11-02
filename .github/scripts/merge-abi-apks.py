#!/usr/bin/env python3
"""Build a universal APK by combining ABI-specific APK native libraries."""

import argparse
import hashlib
import json
from pathlib import Path
import zipfile


ABIS = ("armeabi-v7a", "arm64-v8a", "x86", "x86_64")
BASE_ABI = "arm64-v8a"

# Build-time files that legitimately differ between per-ABI APKs built from
# one commit. The expo-updates manifest embeds a random update id and the
# packaging commitTime; resources.arsc's string pool can differ by a few
# alignment bytes. Both are ABI-independent, so the base ABI's copy is
# canonical for the universal APK — after cross-ABI semantic checks.
VOLATILE = ("assets/app.manifest", "resources.arsc")
# arsc string-pool alignment differences observed across ABIs are tiny.
ARSC_MAX_SIZE_DELTA = 8


def check_manifests(manifests: dict):
    """The four embedded asset manifests must agree on everything but their
    volatile build id/timestamp; otherwise the APKs are not builds of the
    same release and must not be merged. The runtime fingerprint itself
    (assets/fingerprint) is covered by the strict per-entry comparison."""
    reduced = {}
    for abi, raw in manifests.items():
        data = json.loads(raw)
        reduced[abi] = {k: v for k, v in data.items() if k not in ("id", "commitTime")}
    distinct = set(map(lambda payload: json.dumps(payload, sort_keys=True), reduced.values()))
    if len(distinct) != 1:
        raise ValueError("embedded asset manifests disagree across ABIs "
                         "(beyond build id/commitTime); refusing to merge")
    print(f"embedded asset manifests agree across {len(manifests)} ABIs")


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
            and info.filename not in VOLATILE
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
    manifests = {}
    base_sizes = {}
    for abi in ABIS:
        path = getattr(args, abi.replace("-", "_"))
        infos, common, libraries = read_apk(path, abi)
        if common_entries is None:
            common_entries = common
        elif common != common_entries:
            changed = sorted(set(common) | set(common_entries))
            changed = [name for name in changed if common.get(name) != common_entries.get(name)]
            raise ValueError(f"{path}: non-library APK contents differ: {changed[:20]}")
        # ZipInfo offsets are only valid for the file they came from; the
        # canonical non-lib entries must come from the base ABI's own listing.
        if abi == BASE_ABI:
            base_infos = infos
        with zipfile.ZipFile(path) as apk:
            if "assets/app.manifest" in apk.namelist():
                manifests[abi] = apk.read("assets/app.manifest")
            for name in VOLATILE:
                try:
                    size = apk.getinfo(name).file_size
                except KeyError:
                    continue
                if abi == BASE_ABI:
                    base_sizes[name] = size
                elif name in base_sizes and abs(size - base_sizes[name]) > ARSC_MAX_SIZE_DELTA:
                    raise ValueError(f"{path}: {name} size {size} differs from base "
                                     f"{base_sizes[name]} by more than {ARSC_MAX_SIZE_DELTA} bytes")
        entries.update(libraries)

    if len(manifests) == len(ABIS):
        check_manifests(manifests)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(args.output, "w") as merged:
        with zipfile.ZipFile(getattr(args, BASE_ABI.replace("-", "_"))) as base:
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
