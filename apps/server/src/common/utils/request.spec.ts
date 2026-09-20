import type { Request } from "express";
import {
  attachClientIp,
  getAccessCookie,
  getAccessToken,
  getBearerToken,
  getClientIp,
  getCsrfCookie,
  getRefreshToken,
  normalizeIp,
  resolveClientIp,
} from "./request.js";

function fakeReq(opts: { forwarded?: string; remote?: string; ip?: string }): Request {
  return {
    get: (name: string) =>
      name.toLowerCase() === "x-forwarded-for" ? opts.forwarded : undefined,
    socket: { remoteAddress: opts.remote ?? "10.0.0.1" },
    ip: opts.ip ?? opts.remote ?? "10.0.0.1",
  } as unknown as Request;
}

describe("client IP", () => {
  it("normalizes IPv6-mapped IPv4 and bracketed addresses", () => {
    expect(normalizeIp("::ffff:127.0.0.1")).toBe("127.0.0.1");
    expect(normalizeIp("[2001:db8::1]")).toBe("2001:db8::1");
    expect(normalizeIp("")).toBe("unknown");
  });

  it("ignores X-Forwarded-For when hop count is 0", () => {
    const req = fakeReq({ forwarded: "8.8.8.8", remote: "10.0.0.1" });
    expect(resolveClientIp(req, 0)).toBe("10.0.0.1");
    expect(getClientIp(req)).toBe("10.0.0.1");
  });

  it("takes the client to the left of trusted hops", () => {
    const req = fakeReq({
      forwarded: "9.9.9.9, 203.0.113.10",
      remote: "10.0.0.1",
    });
    expect(resolveClientIp(req, 1)).toBe("203.0.113.10");
  });

  it("does not let extra spoofed hops skip past a single trusted proxy", () => {
    const req = fakeReq({
      forwarded: "1.1.1.1, 2.2.2.2, 203.0.113.10",
      remote: "10.0.0.1",
    });
    expect(resolveClientIp(req, 1)).toBe("203.0.113.10");
  });

  it("falls back to the socket when the forwarded header is missing", () => {
    const req = fakeReq({ remote: "::ffff:192.168.1.8" });
    expect(resolveClientIp(req, 1)).toBe("192.168.1.8");
  });

  it("caches the resolved IP on the request", () => {
    const req = fakeReq({ forwarded: "203.0.113.10", remote: "10.0.0.1" });
    expect(attachClientIp(req, 1)).toBe("203.0.113.10");
    expect(getClientIp(req)).toBe("203.0.113.10");
  });
});

describe("request tokens", () => {
  it("prefers Bearer over cookies and reads both cookie name variants", () => {
    const req = {
      get: (name: string) =>
        name.toLowerCase() === "authorization" ? "Bearer abc" : undefined,
      cookies: {
        ordo_access: "cookie-access",
        "__Host-ordo_access": "host-access",
        ordo_refresh: "cookie-refresh",
        "__Host-ordo_refresh": "host-refresh",
        ordo_csrf: "cookie-csrf",
        "__Host-ordo_csrf": "host-csrf",
      },
    } as unknown as Request;

    expect(getBearerToken(req)).toBe("abc");
    expect(getAccessToken(req)).toBe("abc");
    expect(getAccessCookie(req)).toBe("host-access");
    expect(getRefreshToken(req)).toBe("host-refresh");
    expect(getCsrfCookie(req)).toBe("host-csrf");
  });
});
