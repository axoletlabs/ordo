#!/usr/bin/env python3
"""Check packaged binaries, rather than trusting prebuild/Gradle inputs."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import zipfile


def output(*args):
    return subprocess.check_output(args, text=True, stderr=subprocess.STDOUT)


def verify(apk, *, aapt, apksigner, version, base, runtime, channel, certificate):
    signatures = output(apksigner, "verify", "--print-certs", str(apk))
    digests = re.findall(r"certificate SHA-?256 digest:\s*([a-fA-F0-9]{64})", signatures, re.I)
    if len(digests) != 1 or digests[0].lower() != certificate.lower():
        raise ValueError(f"{apk.name}: signer does not match the stored upload key "
                         f"(expected {certificate}, found {[d.lower() for d in digests] or 'none'}). "
                         f"apksigner said: {signatures[:600]!r}")
    badging = output(aapt, "dump", "badging", str(apk))
    package = re.search(r"package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'", badging)
    # Every APK of the build — universal and all splits — shares the run number.
    if not package or package.groups() != ("com.axolet.ordo", str(base), version):
        raise ValueError(f"{apk.name}: wrong package, native version or versionCode")
    resources = output(aapt, "dump", "--values", "resources", str(apk))
    value = re.search(r'\bstring/expo_runtime_version\b(?:(?!\bresource\b).)*?\(string(?:8|16)\)\s+"([^"]+)"', resources, re.S)
    embedded_runtime = value.group(1) if value else None
    # Expo SDK 57 reads fingerprint runtimes from an asset; the Android
    # resource is a sentinel, not the fingerprint itself.
    if embedded_runtime == "file:fingerprint":
        with zipfile.ZipFile(apk) as archive:
            embedded_runtime = archive.read("assets/fingerprint").decode().strip()
    if embedded_runtime != runtime:
        raise ValueError(f"{apk.name}: embedded runtime does not match the uploaded APK runtime")
    manifest = output(aapt, "dump", "xmltree", str(apk), "AndroidManifest.xml")
    header_block = next((block for block in re.split(r"\n\s*E: meta-data[^\n]*\n", manifest)
                         if "expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY" in block), None)
    header_value = re.search(r'android:value[^\n]*=("(?:\\.|[^"\\])*")', header_block or "")
    if not header_value or json.loads(json.loads(header_value.group(1))).get("expo-channel-name") != channel:
        raise ValueError(f"{apk.name}: embedded update channel does not match the selected stream")
    print(f"Verified {apk.name}: version={version}, code={base}, channel={channel}, runtime={runtime}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path)
    parser.add_argument("--version", required=True)
    parser.add_argument("--base-code", type=int, required=True)
    parser.add_argument("--runtime", required=True)
    parser.add_argument("--channel", required=True)
    parser.add_argument("--release", action="store_true")
    args = parser.parse_args()
    sdk = Path(os.environ.get("ANDROID_HOME") or os.environ["ANDROID_SDK_ROOT"])
    tools = sorted((sdk / "build-tools").glob("*"), key=lambda path: [int(n) for n in re.findall(r"\d+", path.name)])
    tools = next((path for path in reversed(tools) if (path / "aapt").is_file() and (path / "apksigner").is_file()), None)
    if not tools:
        raise ValueError("Android aapt and apksigner are required to verify packaged APKs")
    certificate = subprocess.check_output([
        "keytool", "-exportcert", "-keystore", os.environ["ORDO_UPLOAD_STORE_FILE"],
        "-storetype", os.environ.get("ORDO_UPLOAD_STORE_TYPE", "PKCS12"),
        "-storepass:env", "ORDO_UPLOAD_STORE_PASSWORD", "-alias", os.environ.get("ORDO_UPLOAD_KEY_ALIAS", "ordo"),
    ], stderr=subprocess.PIPE)
    expected = {"app-release.apk"} if not args.release else {
        "app-universal-release.apk", "app-armeabi-v7a-release.apk", "app-arm64-v8a-release.apk", "app-x86-release.apk", "app-x86_64-release.apk",
    }
    apks = list(args.directory.glob("*.apk"))
    if {apk.name for apk in apks} != expected:
        raise ValueError("Packaged APK set is incomplete or includes unsigned/unexpected binaries")
    for apk in apks:
        verify(apk, aapt=str(tools / "aapt"), apksigner=str(tools / "apksigner"),
               version=args.version, base=args.base_code, runtime=args.runtime,
               channel=args.channel, certificate=hashlib.sha256(certificate).hexdigest())


if __name__ == "__main__":
    main()
