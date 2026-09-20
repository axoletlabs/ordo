import { APP_NAME } from "@ordo/shared";

/** Pretty host (without scheme) for display. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Instance title for chrome. Uses the server-reported display name and never
 * repeats the URL host — that belongs on the address line underneath.
 */
export function instanceNameOf(
  info: { name?: string | null } | null | undefined,
  url: string,
): string {
  const host = hostOf(url);
  const dupes = new Set(
    [host, url, host.replace(/:\d+$/, "")]
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  const value = info?.name?.trim();
  if (value && !dupes.has(value.toLowerCase()) && !/^https?:\/\//i.test(value)) {
    return value;
  }
  return APP_NAME;
}
