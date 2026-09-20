import type { CookieOptions, Request, Response } from "express";
import { COOKIES, CSRF_TOKEN_HEADER, TOKEN_TTL } from "@ordo/shared";
import { generateToken } from "../common/utils/tokens.js";

const HTTP_PATH = "/api";
const HTTPS_PATH = "/";

interface CookieTokens {
  accessToken: string;
  refreshToken: string;
}

function names(secure: boolean) {
  return secure
    ? {
        access: COOKIES.ACCESS_HOST,
        refresh: COOKIES.REFRESH_HOST,
        csrf: COOKIES.CSRF_HOST,
      }
    : {
        access: COOKIES.ACCESS,
        refresh: COOKIES.REFRESH,
        csrf: COOKIES.CSRF,
      };
}

function baseCookie(secure: boolean, httpOnly: boolean): CookieOptions {
  return {
    httpOnly,
    secure,
    sameSite: "lax",
    path: secure ? HTTPS_PATH : HTTP_PATH,
  };
}

function setCsrfCookie(req: Request, res: Response): void {
  const secure = req.secure;
  const token = generateToken(32);
  res.cookie(names(secure).csrf, token, {
    ...baseCookie(secure, false),
    maxAge: TOKEN_TTL.REFRESH_MS,
  });
  res.setHeader(CSRF_TOKEN_HEADER, token);
}

/** httpOnly session cookies. Secure + `__Host-` only when this request is HTTPS. */
export function setAuthCookies(req: Request, res: Response, tokens: CookieTokens): void {
  const secure = req.secure;
  const key = names(secure);
  const auth = baseCookie(secure, true);
  res.cookie(key.access, tokens.accessToken, { ...auth, maxAge: TOKEN_TTL.ACCESS_MS });
  res.cookie(key.refresh, tokens.refreshToken, { ...auth, maxAge: TOKEN_TTL.REFRESH_MS });
  setCsrfCookie(req, res);

  // Drop the other transport's leftovers so a later HTTP/HTTPS flip cannot
  // leave two access cookies for `getAccessToken` to pick from.
  if (secure) {
    for (const name of [COOKIES.ACCESS, COOKIES.REFRESH, COOKIES.CSRF]) {
      res.clearCookie(name, { path: HTTP_PATH });
    }
  } else {
    for (const name of [COOKIES.ACCESS_HOST, COOKIES.REFRESH_HOST, COOKIES.CSRF_HOST]) {
      res.clearCookie(name, { path: HTTPS_PATH, secure: true });
    }
  }
}

export function clearAuthCookies(res: Response): void {
  for (const name of [COOKIES.ACCESS, COOKIES.REFRESH, COOKIES.CSRF]) {
    res.clearCookie(name, { path: HTTP_PATH });
    res.clearCookie(name, { path: HTTPS_PATH });
  }
  for (const name of [COOKIES.ACCESS_HOST, COOKIES.REFRESH_HOST, COOKIES.CSRF_HOST]) {
    res.clearCookie(name, { path: HTTPS_PATH, secure: true });
  }
}
