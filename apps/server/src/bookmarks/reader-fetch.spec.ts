import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Production extraction must call npm `undici`'s fetch with npm `undici`'s
 * Agent. Node's global fetch is a different undici copy; mixing them throws
 * `invalid onRequestStart method` and every bookmark lands on `fetch_error`.
 *
 * Do not exercise undici's web `fetch` inside Jest — it calls
 * `removeAbortListener`, which Jest's Node environment does not provide.
 */
describe("article fetch dispatcher", () => {
  it("pairs the undici Agent with undici fetch, not global fetch", () => {
    const src = readFileSync(join(__dirname, "reader.service.ts"), "utf8");
    expect(src).toContain('import { Agent, fetch as undiciFetch } from "undici"');
    expect(src).toContain("undiciFetch(current");
    expect(src).toContain("dispatcher: this.dispatcher");
    expect(src).toContain("await fetch(current, { redirect: \"manual\", signal: combined, headers })");
  });
});
