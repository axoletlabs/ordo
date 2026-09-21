import { FetchBudget, isPublicIp, looksLikeNonCanonicalIp, canonicalHostname } from "./public-destination.js";
import { UnsupportedContentError } from "./reader-errors.js";

describe("isPublicIp", () => {
  it("allows ordinary public IPv4 and IPv6", () => {
    expect(isPublicIp("8.8.8.8")).toBe(true);
    expect(isPublicIp("1.1.1.1")).toBe(true);
    expect(isPublicIp("2001:4860:4860::8888")).toBe(true);
  });

  it("rejects loopback, RFC1918, link-local, CGNAT, and multicast", () => {
    expect(isPublicIp("127.0.0.1")).toBe(false);
    expect(isPublicIp("0.0.0.0")).toBe(false);
    expect(isPublicIp("10.0.0.1")).toBe(false);
    expect(isPublicIp("192.168.1.1")).toBe(false);
    expect(isPublicIp("172.16.4.1")).toBe(false);
    expect(isPublicIp("169.254.169.254")).toBe(false);
    expect(isPublicIp("100.64.0.1")).toBe(false);
    expect(isPublicIp("224.0.0.1")).toBe(false);
    expect(isPublicIp("255.255.255.255")).toBe(false);
    expect(isPublicIp("::1")).toBe(false);
    expect(isPublicIp("fc00::1")).toBe(false);
    expect(isPublicIp("fe80::1")).toBe(false);
    expect(isPublicIp("ff02::1")).toBe(false);
    expect(isPublicIp("2001:db8::1")).toBe(false);
  });

  it("rejects IPv4-mapped, NAT64, and 6to4 encodings of private IPv4", () => {
    expect(isPublicIp("::ffff:127.0.0.1")).toBe(false);
    expect(isPublicIp("::ffff:192.168.0.1")).toBe(false);
    expect(isPublicIp("64:ff9b::7f00:1")).toBe(false);
    expect(isPublicIp("2002:7f00:1::1")).toBe(false);
    expect(isPublicIp("::ffff:8.8.8.8")).toBe(true);
  });
});

describe("looksLikeNonCanonicalIp", () => {
  it("flags decimal, octal, hex, and short IPv4 literals", () => {
    expect(looksLikeNonCanonicalIp("127.1")).toBe(true);
    expect(looksLikeNonCanonicalIp("127.0.1")).toBe(true);
    expect(looksLikeNonCanonicalIp("2130706433")).toBe(true);
    expect(looksLikeNonCanonicalIp("0x7f000001")).toBe(true);
    expect(looksLikeNonCanonicalIp("0177.0.0.1")).toBe(true);
    expect(looksLikeNonCanonicalIp("127.0.0.1")).toBe(false);
    expect(looksLikeNonCanonicalIp("example.com")).toBe(false);
  });
});

describe("canonicalHostname", () => {
  it("strips brackets and trailing dots", () => {
    expect(canonicalHostname("[::1]")).toBe("::1");
    expect(canonicalHostname("Example.COM.")).toBe("example.com");
  });
});

describe("FetchBudget", () => {
  it("caps a single user and the process as a whole", () => {
    const budget = new FetchBudget();
    for (let i = 0; i < 60; i++) budget.consume("u1");
    expect(() => budget.consume("u1")).toThrow(UnsupportedContentError);
    expect(() => budget.consume("u2")).not.toThrow();
  });
});
