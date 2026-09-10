/** Pretty host (without scheme) for display. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Editable instance title. Prefers the server-reported name/hostname and
 * never repeats the URL host — that belongs on the address line underneath.
 */
export function instanceNameOf(
  info: { name?: string | null; hostname?: string | null } | null | undefined,
  url: string,
): string {
  const host = hostOf(url);
  const dupes = new Set(
    [host, url, host.replace(/:\d+$/, "")]
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  for (const raw of [info?.name, info?.hostname]) {
    if (typeof raw !== "string") continue;
    const value = raw.trim();
    if (!value) continue;
    if (dupes.has(value.toLowerCase())) continue;
    if (/^https?:\/\//i.test(value)) continue;
    return value;
  }
  return "Server";
}
