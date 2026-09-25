import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Fallback when this tree was not installed from a GitHub Release. */
export const BUNDLED_SERVER_VERSION = "0.1.0";

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
