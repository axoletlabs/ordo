import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUNDLED_SERVER_VERSION, readServerVersion } from "./release-version.js";

describe("readServerVersion", () => {
  it("uses release.json when the deploy recorded one", () => {
    const dir = mkdtempSync(join(tmpdir(), "ordo-version-"));
    try {
      writeFileSync(join(dir, "release.json"), JSON.stringify({ version: "0.4.2", tag: "v0.4.2" }));
      expect(readServerVersion(dir)).toBe("0.4.2");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back when the file is missing or unreadable", () => {
    const dir = mkdtempSync(join(tmpdir(), "ordo-version-"));
    try {
      expect(readServerVersion(dir)).toBe(BUNDLED_SERVER_VERSION);
      writeFileSync(join(dir, "release.json"), "{");
      expect(readServerVersion(dir)).toBe(BUNDLED_SERVER_VERSION);
      writeFileSync(join(dir, "release.json"), JSON.stringify({ version: "  " }));
      expect(readServerVersion(dir)).toBe(BUNDLED_SERVER_VERSION);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
