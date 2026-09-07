import { decodeHtmlBytes } from "./reader-parse.js";
import { htmlCacheKey, HtmlCache } from "./html-cache.js";

describe("htmlCacheKey", () => {
  it("drops tracking parameters so the same story reuses HTML", () => {
    expect(htmlCacheKey("https://Example.com/a?utm_source=x&id=1")).toBe(
      htmlCacheKey("https://example.com/a?id=1"),
    );
  });
});

describe("HtmlCache", () => {
  it("coalesces concurrent loads of the same URL", async () => {
    const cache = new HtmlCache();
    let loads = 0;
    const loader = async () => {
      loads += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return "<html></html>";
    };
    const [a, b] = await Promise.all([
      cache.remember("https://example.com/x", loader),
      cache.remember("https://example.com/x?utm_campaign=1", loader),
    ]);
    expect(a).toBe(b);
    expect(loads).toBe(1);
    expect(cache.get("https://example.com/x")).toBe("<html></html>");
  });
});

describe("decodeHtmlBytes", () => {
  it("honors a meta charset over the HTTP default", () => {
    const html = '<meta charset="iso-8859-1">caf\xe9';
    const bytes = Uint8Array.from(html, (ch) => ch.charCodeAt(0));
    expect(decodeHtmlBytes(bytes, "text/html")).toContain("café");
  });
});
