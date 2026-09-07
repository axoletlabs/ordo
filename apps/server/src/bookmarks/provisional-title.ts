/**
 * Instant title from a URL path so a newly saved row is not just the hostname
 * while extraction runs. Conservative: skip IDs, hashes, and tiny slugs.
 */
export function provisionalTitle(url: string, hostname: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return hostname;
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length === 0) return hostname;
  let last = segments[segments.length - 1] ?? "";
  try {
    last = decodeURIComponent(last);
  } catch {
    // keep the raw segment
  }
  last = last.replace(/\.[a-z0-9]{1,8}$/i, "");
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(last)) return hostname;
  if (/^\d{6,}$/.test(last)) return hostname;
  if (/^[0-9a-f]{16,}$/i.test(last)) return hostname;
  const words = last.replace(/[-_+]+/g, " ").replace(/\s+/g, " ").trim();
  if (words.length < 8) return hostname;
  if (!/[a-z]/i.test(words)) return hostname;
  return titleCase(words).slice(0, 500);
}

function titleCase(value: string): string {
  return value.replace(/\p{L}+/gu, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}
