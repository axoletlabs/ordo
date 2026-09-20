import type { Request } from "express";
import {
  CLIENT_TYPE_HEADER,
  CLIENT_TYPE_MOBILE,
  COOKIES,
  DEVICE_NAME_HEADER,
  DEVICE_TYPE_HEADER,
  FOLDER_TOKEN_HEADER,
  REFRESH_TOKEN_HEADER,
  type SessionDeviceType,
} from "@ordo/shared";

export function isMobileClient(req: Request): boolean {
  return req.get(CLIENT_TYPE_HEADER)?.toLowerCase() === CLIENT_TYPE_MOBILE;
}

function cookieValue(req: Request, ...names: string[]): string | null {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  if (!cookies) return null;
  for (const name of names) {
    const value = cookies[name];
    if (typeof value === "string" && value) return value;
  }
  return null;
}

export function getBearerToken(req: Request): string | null {
  const header = req.get("authorization");
  if (!header?.toLowerCase().startsWith("bearer ")) return null;
  return header.slice(7).trim() || null;
}

export function getAccessCookie(req: Request): string | null {
  return cookieValue(req, COOKIES.ACCESS_HOST, COOKIES.ACCESS);
}

export function getCsrfCookie(req: Request): string | null {
  return cookieValue(req, COOKIES.CSRF_HOST, COOKIES.CSRF);
}

export function getAccessToken(req: Request): string | null {
  return getBearerToken(req) ?? getAccessCookie(req);
}

export function getRefreshToken(req: Request): string | null {
  const fromHeader = req.get(REFRESH_TOKEN_HEADER);
  if (fromHeader) return fromHeader;
  const fromBody = (req.body as { refreshToken?: string } | undefined)?.refreshToken;
  if (fromBody) return fromBody;
  return cookieValue(req, COOKIES.REFRESH_HOST, COOKIES.REFRESH);
}

export function getFolderToken(req: Request): string | null {
  const t = req.get(FOLDER_TOKEN_HEADER);
  return t || null;
}

/** Best-effort device description from request headers. */
export function getDeviceInfo(req: Request): string {
  const ua = req.get("user-agent") || "Unknown";
  return ua.slice(0, 512);
}

const DEVICE_TYPES = new Set<SessionDeviceType>(["phone", "tablet", "desktop", "tv", "unknown"]);

/** Untrusted display metadata; values are bounded before persistence. */
export function getDeviceMetadata(req: Request): {
  deviceInfo: string;
  deviceName: string | null;
  deviceType: SessionDeviceType;
} {
  const deviceInfo = getDeviceInfo(req);
  const encodedName = req.get(DEVICE_NAME_HEADER);
  let deviceName: string | null = null;
  if (encodedName) {
    try {
      deviceName = decodeURIComponent(encodedName).trim().slice(0, 120) || null;
    } catch {
      deviceName = encodedName.trim().slice(0, 120) || null;
    }
  }

  if (!deviceName) {
    const androidModel = deviceInfo.match(/Android[^;]*;\s*([^;)]+?)(?:\s+Build\/|[;)])/i)?.[1];
    deviceName = androidModel?.trim() ||
      (/ipad/i.test(deviceInfo)
        ? "iPad"
        : /iphone/i.test(deviceInfo)
          ? "iPhone"
          : /windows/i.test(deviceInfo)
            ? "Windows PC"
            : /macintosh|mac os/i.test(deviceInfo)
              ? "Mac"
              : /linux/i.test(deviceInfo)
                ? "Linux device"
                : null);
  }

  const requestedType = req.get(DEVICE_TYPE_HEADER)?.toLowerCase() as SessionDeviceType | undefined;
  const deviceType = requestedType && DEVICE_TYPES.has(requestedType)
    ? requestedType
    : /ipad|tablet/i.test(deviceInfo)
      ? "tablet"
      : /iphone|android|mobile/i.test(deviceInfo)
        ? "phone"
        : /windows|macintosh|mac os|linux/i.test(deviceInfo)
          ? "desktop"
          : "unknown";

  return { deviceInfo, deviceName, deviceType };
}

const CLIENT_IP = Symbol.for("ordo.clientIp");

type RequestWithClientIp = Request & { [CLIENT_IP]?: string };

/** Strip IPv6-mapped IPv4 and brackets so bucket keys stay stable. */
export function normalizeIp(raw: string): string {
  let ip = raw.trim();
  if (ip.startsWith("[") && ip.endsWith("]")) ip = ip.slice(1, -1);
  if (ip.toLowerCase().startsWith("::ffff:")) ip = ip.slice(7);
  return ip.slice(0, 64) || "unknown";
}

/**
 * Client IP from the socket plus `X-Forwarded-For`, trusting `trustProxyHops`
 * proxies (counting from the right). Hop count 0 ignores forwarded headers so
 * clients cannot spoof the IP used for rate limits.
 */
export function resolveClientIp(req: Request, trustProxyHops: number): string {
  const socketIp = normalizeIp(req.socket?.remoteAddress || req.ip || "");
  const hops = Number.isFinite(trustProxyHops) ? Math.max(0, Math.trunc(trustProxyHops)) : 0;
  if (hops <= 0) return socketIp;

  const fwd = req.get("x-forwarded-for");
  if (!fwd) return socketIp;

  const forwarded = fwd
    .split(",")
    .map((s) => normalizeIp(s))
    .filter((s) => s !== "unknown");
  const chain = [...forwarded, socketIp];
  const index = Math.max(0, chain.length - 1 - hops);
  return chain[index] ?? socketIp;
}

/** Cache the resolved IP on the request (called by ClientIpMiddleware). */
export function attachClientIp(req: Request, trustProxyHops: number): string {
  const ip = resolveClientIp(req, trustProxyHops);
  (req as RequestWithClientIp)[CLIENT_IP] = ip;
  return ip;
}

/**
 * Client IP for rate limits and session metadata.
 * Uses the middleware-resolved value when present; otherwise the socket
 * address (forwarded headers are not trusted without hop count).
 */
export function getClientIp(req: Request): string {
  const cached = (req as RequestWithClientIp)[CLIENT_IP];
  if (cached) return cached;
  return resolveClientIp(req, 0);
}
