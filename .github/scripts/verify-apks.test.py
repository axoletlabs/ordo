"""Hermetic checks for the APK identity/OTA verifier; no Android SDK required."""
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("verify_apks", Path(__file__).with_name("verify-apks.py"))
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)

PACKAGES = {"stable": "com.axolet.ordo", "preview": "com.axolet.ordo.preview",
            "development": "com.axolet.ordo.development"}


def metadata(name, value):
    return f'\n  E: meta-data\n    A: android:name="{name}"\n    A: android:value={value}\n'


def verify(variant, package=None, channel=None, enabled=None, headers=True):
    package = package or PACKAGES[variant]
    channel = channel or variant
    enabled = variant != "development" if enabled is None else enabled
    manifest = metadata("expo.modules.updates.ENABLED", "(type 0x12)0xffffffff" if enabled else "(type 0x12)0x0")
    if headers:
        manifest += metadata("expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY",
                             json.dumps(json.dumps({"expo-channel-name": channel})))

    def output(*args):
        if args[0] == "apksigner":
            return "Signer #1 certificate SHA-256 digest: " + "a" * 64
        if "badging" in args:
            return f"package: name='{package}' versionCode='42' versionName='0.2.0'"
        if "resources" in args:
            return 'resource 0x7f string/expo_runtime_version\n  (string8) "runtime"'
        return manifest

    with patch.object(verifier, "output", output):
        verifier.verify(Path("app-release.apk"), aapt="aapt", apksigner="apksigner",
                        version="0.2.0", base=42, runtime="runtime", channel=variant, certificate="a" * 64)


class VariantVerification(unittest.TestCase):
    def test_fixed_packages_and_release_channels(self):
        for variant in PACKAGES:
            verify(variant, headers=variant != "development")
            for other, package in PACKAGES.items():
                if other != variant:
                    with self.assertRaisesRegex(ValueError, "wrong package"):
                        verify(variant, package=package, headers=variant != "development")

    def test_release_ota_must_be_enabled_on_the_right_channel(self):
        for variant, other in [("stable", "preview"), ("preview", "stable")]:
            with self.assertRaisesRegex(ValueError, "enable OTA"):
                verify(variant, enabled=False)
            with self.assertRaisesRegex(ValueError, "channel"):
                verify(variant, channel=other)
            with self.assertRaisesRegex(ValueError, "channel"):
                verify(variant, headers=False)

    def test_development_has_neither_ota_nor_subscription(self):
        with self.assertRaisesRegex(ValueError, "disable OTA"):
            verify("development", enabled=True, headers=False)
        with self.assertRaisesRegex(ValueError, "omit update headers"):
            verify("development", headers=True)


if __name__ == "__main__":
    unittest.main()
