import type { Request, Response } from "express";
import { COOKIES, CSRF_TOKEN_HEADER, TOKEN_TTL } from "@ordo/shared";
import { clearAuthCookies, setAuthCookies } from "./cookies.js";

interface StoredCookie {
  value: string;
  options: Record<string, unknown>;
}

function mockRes() {
  const cookies = new Map<string, StoredCookie>();
  const cleared: { name: string; options: Record<string, unknown> }[] = [];
  const headers = new Map<string, string>();
  const res = {
    cookie(name: string, value: string, options: Record<string, unknown>) {
      cookies.set(name, { value, options });
    },
    clearCookie(name: string, options: Record<string, unknown>) {
      cookies.delete(name);
      cleared.push({ name, options });
    },
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
    },
  } as unknown as Response;
  return { res, cookies, cleared, headers };
}

describe("auth cookies", () => {
  const tokens = { accessToken: "access", refreshToken: "refresh" };

  it("uses ordo_* names, Path=/api, and no Secure on HTTP", () => {
    const { res, cookies, headers } = mockRes();
    setAuthCookies({ secure: false } as Request, res, tokens);

    expect(cookies.get(COOKIES.ACCESS)).toMatchObject({
      value: "access",
      options: {
        httpOnly: true,
        secure: false,
        sameSite: "lax",
        path: "/api",
        maxAge: TOKEN_TTL.ACCESS_MS,
      },
    });
    expect(cookies.get(COOKIES.REFRESH)?.options).toMatchObject({
      httpOnly: true,
      secure: false,
      path: "/api",
      maxAge: TOKEN_TTL.REFRESH_MS,
    });
    expect(cookies.get(COOKIES.CSRF)?.options).toMatchObject({
      httpOnly: false,
      secure: false,
      path: "/api",
    });
    expect(cookies.has(COOKIES.ACCESS_HOST)).toBe(false);
    expect(headers.get(CSRF_TOKEN_HEADER)).toBe(cookies.get(COOKIES.CSRF)?.value);
  });

  it("uses __Host- names, Path=/, and Secure on HTTPS", () => {
    const { res, cookies } = mockRes();
    setAuthCookies({ secure: true } as Request, res, tokens);

    expect(cookies.get(COOKIES.ACCESS_HOST)).toMatchObject({
      value: "access",
      options: {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: TOKEN_TTL.ACCESS_MS,
      },
    });
    expect(cookies.get(COOKIES.REFRESH_HOST)?.options.path).toBe("/");
    expect(cookies.get(COOKIES.CSRF_HOST)?.options).toMatchObject({
      httpOnly: false,
      secure: true,
      path: "/",
    });
    expect(cookies.has(COOKIES.ACCESS)).toBe(false);
  });

  it("clears both HTTP and HTTPS cookie names", () => {
    const { res, cleared } = mockRes();
    clearAuthCookies(res);
    const names = cleared.map((entry) => entry.name);
    expect(names).toEqual(
      expect.arrayContaining([
        COOKIES.ACCESS,
        COOKIES.REFRESH,
        COOKIES.CSRF,
        COOKIES.ACCESS_HOST,
        COOKIES.REFRESH_HOST,
        COOKIES.CSRF_HOST,
      ]),
    );
    expect(cleared.find((entry) => entry.name === COOKIES.ACCESS_HOST)?.options).toEqual({
      path: "/",
      secure: true,
    });
  });
});
