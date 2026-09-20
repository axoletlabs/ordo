import { timingSafeEqual } from "node:crypto";
import type { Request } from "express";

/** Compare operator secrets without leaking length via a fast path alone. */
export function secretsEqual(given: string, expected: string): boolean {
  if (!expected) return false;
  const left = Buffer.from(given, "utf8");
  const right = Buffer.from(expected, "utf8");
  if (left.length !== right.length) {
    timingSafeEqual(right, right);
    return false;
  }
  return timingSafeEqual(left, right);
}

export function extractStatsSecret(req: Request): string {
  const header = req.headers.authorization;
  if (typeof header === "string") {
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (match?.[1]) return match[1].trim();
  }
  const custom = req.headers["x-telemetry-secret"];
  if (typeof custom === "string" && custom.trim()) return custom.trim();
  const query = req.query.secret;
  if (typeof query === "string") return query;
  return "";
}

export function wantsHtml(req: Request): boolean {
  const format = typeof req.query.format === "string" ? req.query.format.trim().toLowerCase() : "";
  if (format === "json") return false;
  if (format === "html") return true;
  const accept = req.headers.accept ?? "";
  return accept.includes("text/html");
}
