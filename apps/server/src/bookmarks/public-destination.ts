import { BlockList, isIP } from "node:net";
import { UnsupportedContentError } from "./reader-errors.js";

const PRIVATE_V4 = new BlockList();
PRIVATE_V4.addSubnet("0.0.0.0", 8, "ipv4");
PRIVATE_V4.addSubnet("10.0.0.0", 8, "ipv4");
PRIVATE_V4.addSubnet("100.64.0.0", 10, "ipv4");
PRIVATE_V4.addSubnet("127.0.0.0", 8, "ipv4");
PRIVATE_V4.addSubnet("169.254.0.0", 16, "ipv4");
PRIVATE_V4.addSubnet("172.16.0.0", 12, "ipv4");
PRIVATE_V4.addSubnet("192.0.0.0", 24, "ipv4");
PRIVATE_V4.addSubnet("192.0.2.0", 24, "ipv4");
PRIVATE_V4.addSubnet("192.88.99.0", 24, "ipv4");
PRIVATE_V4.addSubnet("192.168.0.0", 16, "ipv4");
PRIVATE_V4.addSubnet("198.18.0.0", 15, "ipv4");
PRIVATE_V4.addSubnet("198.51.100.0", 24, "ipv4");
PRIVATE_V4.addSubnet("203.0.113.0", 24, "ipv4");
PRIVATE_V4.addSubnet("224.0.0.0", 4, "ipv4");
PRIVATE_V4.addSubnet("240.0.0.0", 4, "ipv4");

const PRIVATE_V6 = new BlockList();
PRIVATE_V6.addAddress("::", "ipv6");
PRIVATE_V6.addAddress("::1", "ipv6");
PRIVATE_V6.addSubnet("fc00::", 7, "ipv6");
PRIVATE_V6.addSubnet("fe80::", 10, "ipv6");
PRIVATE_V6.addSubnet("fec0::", 10, "ipv6");
PRIVATE_V6.addSubnet("ff00::", 8, "ipv6");
PRIVATE_V6.addSubnet("2001:db8::", 32, "ipv6");
PRIVATE_V6.addSubnet("2001:2::", 48, "ipv6");
PRIVATE_V6.addSubnet("100::", 64, "ipv6");

/** Dotted, octal, hex, or decimal IPv4 written in a non-canonical form. */
const IPV4_LIKE =
  /^(?:\d+|0x[0-9a-f]+|0[0-7]+)(?:\.(?:\d+|0x[0-9a-f]+|0[0-7]+)){0,3}$/i;

export function canonicalHostname(host: string): string {
  return host.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/g, "");
}

export function looksLikeNonCanonicalIp(host: string): boolean {
  if (!host) return true;
  if (isIP(host)) return false;
  return IPV4_LIKE.test(host);
}

export function isSpecialUseHostname(host: string): boolean {
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".home.arpa") ||
    host.endsWith(".lan") ||
    host.endsWith(".corp") ||
    host === "metadata.google.internal"
  );
}

export function isPublicIp(address: string): boolean {
  if (!address) return false;
  const embedded =
    ipv4Mapped(address) ?? ipv4FromNat64(address) ?? ipv4From6to4(address);
  if (embedded) return isPublicIp(embedded);

  const family = isIP(address);
  if (family === 4) return !PRIVATE_V4.check(address, "ipv4");
  if (family === 6) return !PRIVATE_V6.check(address, "ipv6");
  return false;
}

export function assertHttpUrl(url: URL): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsupportedContentError("non_html_content", "Only HTTP pages are supported");
  }
}

export function assertPublicHost(host: string): void {
  if (!host || isSpecialUseHostname(host) || looksLikeNonCanonicalIp(host)) {
    throw new UnsupportedContentError("non_html_content", "Private network URLs are not supported");
  }
  if (isIP(host) && !isPublicIp(host)) {
    throw new UnsupportedContentError("non_html_content", "Private network URLs are not supported");
  }
}

function ipv4Mapped(address: string): string | null {
  const n = address.toLowerCase();
  const dotted = n.match(/:ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) return dotted[1];
  const hex = n.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  return ipv4FromHexPair(hex[1], hex[2]);
}

function ipv4FromNat64(address: string): string | null {
  const n = address.toLowerCase();
  if (!n.startsWith("64:ff9b:")) return null;
  const dotted = n.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) return dotted[1];
  const hex = n.match(/^64:ff9b::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  return ipv4FromHexPair(hex[1], hex[2]);
}

function ipv4From6to4(address: string): string | null {
  const n = address.toLowerCase();
  if (!n.startsWith("2002:")) return null;
  const parts = n.split(":");
  if (parts.length < 3 || !parts[1] || !parts[2]) return null;
  return ipv4FromHexPair(parts[1], parts[2]);
}

function ipv4FromHexPair(high: string, low: string): string | null {
  const hi = Number.parseInt(high, 16);
  const lo = Number.parseInt(low, 16);
  if (!Number.isInteger(hi) || !Number.isInteger(lo)) return null;
  return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
}

const USER_FETCH_LIMIT = 60;
const GLOBAL_FETCH_LIMIT = 180;
const FETCH_WINDOW_MS = 60_000;

/** In-process fetch caps so reader SSRF cannot pin the event loop. */
export class FetchBudget {
  private readonly users = new Map<string, { count: number; resetAt: number }>();
  private global = { count: 0, resetAt: 0 };

  consume(userId?: string): void {
    const now = Date.now();
    this.global = this.bump(this.global, GLOBAL_FETCH_LIMIT, now);
    if (!userId) return;
    const next = this.bump(this.users.get(userId) ?? { count: 0, resetAt: 0 }, USER_FETCH_LIMIT, now);
    this.users.delete(userId);
    this.users.set(userId, next);
    if (this.users.size > 20_000) {
      const oldest = this.users.keys().next().value;
      if (oldest) this.users.delete(oldest);
    }
  }

  private bump(
    entry: { count: number; resetAt: number },
    limit: number,
    now: number,
  ): { count: number; resetAt: number } {
    const fresh =
      !entry.resetAt || now >= entry.resetAt
        ? { count: 0, resetAt: now + FETCH_WINDOW_MS }
        : entry;
    if (fresh.count >= limit) {
      throw new UnsupportedContentError(
        "non_html_content",
        "Too many URL fetches. Try again shortly.",
      );
    }
    return { count: fresh.count + 1, resetAt: fresh.resetAt };
  }
}
