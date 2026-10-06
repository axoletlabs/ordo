import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Read the version from apps/server/package.json so it can't drift from the
 * declared one. Works from both src/ (tests) and dist/ (two levels down).
 */
function readPackageVersion(): string {
  try {
    const pkg: unknown = JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf8"));
    const version = (pkg as { version?: unknown }).version;
    if (typeof version === "string" && version.trim()) return version.trim();
  } catch {
    // fall through to the literal
  }
  return "0.1.0";
}

/** Fallback when this tree was not installed from a GitHub Release. */
export const BUNDLED_SERVER_VERSION = readPackageVersion();

/**
 * Version recorded by scripts/deploy-server (or the release archive) in
 * apps/server/release.json. The process is started with that directory as cwd.
 */
export function readServerVersion(serverDir = process.cwd()): string {
  const path = join(serverDir, "release.json");
  if (!existsSync(path)) return BUNDLED_SERVER_VERSION;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (
      parsed &&
      typeof parsed === "object" &&
      "version" in parsed &&
      typeof parsed.version === "string" &&
      parsed.version.trim()
    ) {
      return parsed.version.trim();
    }
  } catch {
    return BUNDLED_SERVER_VERSION;
  }
  return BUNDLED_SERVER_VERSION;
}
