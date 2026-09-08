import { createServer } from "node:http";
import { Agent, fetch as undiciFetch } from "undici";
import { DnsCache } from "./dns-cache.js";

/**
 * Production extraction must call npm `undici`'s fetch with npm `undici`'s
 * Agent. Node's global fetch is a different undici copy; mixing them throws
 * `invalid onRequestStart method` and every bookmark lands on `fetch_error`.
 */
describe("article fetch dispatcher", () => {
  it("loads HTML through npm undici Agent + undici fetch", async () => {
    const html = "<!doctype html><html><body><p>hello from local article host</p></body></html>";
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    const dispatcher = new Agent({
      connections: 2,
      connect: { timeout: 4_000, lookup: new DnsCache().asLookup() },
    });
    try {
      const res = await undiciFetch(`http://127.0.0.1:${addr.port}/`, {
        dispatcher,
        headers: { accept: "text/html" },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/text\/html/);
      expect(await res.text()).toBe(html);
    } finally {
      await dispatcher.close();
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });
});
