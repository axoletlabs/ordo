import assert from "node:assert/strict";
import { test } from "node:test";
import { register } from "node:module";
import type { GithubApkAsset } from "./native-apk.ts";
register("data:text/javascript," + encodeURIComponent(`export async function resolve(specifier, context, next) {
  return next(specifier.startsWith("./") && !specifier.endsWith(".ts") ? specifier + ".ts" : specifier, context);
}`), { parentURL: import.meta.url });
const { selectReleaseApk } = await import("./native-apk.ts");
function apk(name: string, extra = {}): GithubApkAsset {
  return { name, state: "uploaded", size: 2_000_000,
    browser_download_url: `https://github.com/axoletlabs/ordo/releases/download/v0.2.0/${name}`, ...extra };
}
test("chooses ABI splits in the hardware preference order, then universal", () => {
  const assets = [apk("ordo-v0.2.0.apk"), apk("ordo-v0.2.0-x86.apk"), apk("ordo-v0.2.0-x86_64.apk"), apk("ordo-v0.2.0-arm64-v8a.apk")];
  assert.equal(selectReleaseApk(assets, "0.2.0", ["x86_64", "x86"])?.name, "ordo-v0.2.0-x86_64.apk");
  assert.equal(selectReleaseApk(assets, "0.2.0", ["aarch64"])?.name, "ordo-v0.2.0-arm64-v8a.apk");
  assert.equal(selectReleaseApk(assets, "0.2.0", [])?.name, "ordo-v0.2.0.apk");
  assert.equal(selectReleaseApk([assets[1]], "0.2.0", ["arm64-v8a"]), null);
});
test("ignores incomplete, wrong-version, unofficial, and untrusted assets", () => {
  for (const invalid of [apk("ordo-v0.1.0.apk"), apk("other.apk"), apk("ordo-v0.2.0.apk", { state: "starter" }),
    apk("ordo-v0.2.0.apk", { size: 0 }), apk("ordo-v0.2.0.apk", { browser_download_url: "https://evil.test/app.apk" })]) {
    assert.equal(selectReleaseApk([invalid], "0.2.0", []), null);
  }
  assert.equal(selectReleaseApk([apk("ordo-v0.2.0-beta.2-arm64-v8a.apk")], "0.2.0-beta.2", ["arm64-v8a"])?.name, "ordo-v0.2.0-beta.2-arm64-v8a.apk");
});
