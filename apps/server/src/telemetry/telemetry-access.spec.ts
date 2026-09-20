import { secretsEqual, extractStatsSecret, wantsHtml } from "./telemetry-access.js";
import type { Request } from "express";

function req(partial: Partial<Request>): Request {
  return partial as Request;
}

describe("telemetry-access", () => {
  it("rejects empty expected secrets and mismatched values", () => {
    expect(secretsEqual("a", "")).toBe(false);
    expect(secretsEqual("secret", "secret")).toBe(true);
    expect(secretsEqual("secret", "Secret")).toBe(false);
    expect(secretsEqual("ab", "abc")).toBe(false);
  });

  it("reads bearer, custom header, then query", () => {
    expect(
      extractStatsSecret(req({ headers: { authorization: "Bearer  abc " }, query: {} })),
    ).toBe("abc");
    expect(
      extractStatsSecret(req({ headers: { "x-telemetry-secret": " from-header " }, query: {} })),
    ).toBe("from-header");
    expect(extractStatsSecret(req({ headers: {}, query: { secret: "from-query" } }))).toBe(
      "from-query",
    );
  });

  it("prefers html only for browsers or format=html", () => {
    expect(wantsHtml(req({ headers: { accept: "text/html" }, query: {} }))).toBe(true);
    expect(wantsHtml(req({ headers: { accept: "*/*" }, query: {} }))).toBe(false);
    expect(wantsHtml(req({ headers: { accept: "text/html" }, query: { format: "json" } }))).toBe(
      false,
    );
    expect(wantsHtml(req({ headers: { accept: "*/*" }, query: { format: "html" } }))).toBe(true);
  });
});
