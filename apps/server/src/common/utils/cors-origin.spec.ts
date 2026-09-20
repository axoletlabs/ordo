import {
  corsOriginAllowed,
  isLoopbackOrigin,
  parseCorsAllowlist,
} from "./cors-origin.js";

const self = { protocol: "https", host: "api.ordo.axolet.com" };

describe("parseCorsAllowlist", () => {
  it("splits, trims, and drops trailing slashes", () => {
    expect(parseCorsAllowlist(undefined)).toEqual([]);
    expect(parseCorsAllowlist("")).toEqual([]);
    expect(parseCorsAllowlist(" https://ordo.axolet.com/ , http://localhost:8081 ")).toEqual([
      "https://ordo.axolet.com",
      "http://localhost:8081",
    ]);
  });
});

describe("isLoopbackOrigin", () => {
  it("accepts localhost, 127.0.0.1, and ::1", () => {
    expect(isLoopbackOrigin("http://localhost:8081")).toBe(true);
    expect(isLoopbackOrigin("http://127.0.0.1:3000")).toBe(true);
    expect(isLoopbackOrigin("http://[::1]:8081")).toBe(true);
    expect(isLoopbackOrigin("https://evil.example")).toBe(false);
    expect(isLoopbackOrigin("not a url")).toBe(false);
  });
});

describe("corsOriginAllowed", () => {
  it("allows missing Origin (apps, curl)", () => {
    expect(corsOriginAllowed(undefined, self, [])).toBe(true);
    expect(corsOriginAllowed("", self, ["https://ordo.axolet.com"])).toBe(true);
  });

  it("allows exact allowlist matches and same origin", () => {
    const list = ["https://ordo.axolet.com"];
    expect(corsOriginAllowed("https://ordo.axolet.com/", self, list)).toBe(true);
    expect(corsOriginAllowed("https://api.ordo.axolet.com", self, list)).toBe(true);
    expect(corsOriginAllowed("https://evil.example", self, list)).toBe(false);
  });

  it("allows loopback only when the allowlist is empty", () => {
    expect(corsOriginAllowed("http://localhost:8081", self, [])).toBe(true);
    expect(corsOriginAllowed("http://localhost:8081", self, ["https://ordo.axolet.com"])).toBe(
      false,
    );
    expect(corsOriginAllowed("https://evil.example", self, [])).toBe(false);
  });
});
