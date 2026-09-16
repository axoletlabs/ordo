function firstHttpUrl(text?: string | null): string | null {
  return text?.match(/https?:\/\/[^\s<>"']+/i)?.[0] ?? null;
}

function normalizeSharedUrl(candidate: string): string | null {
  let trimmed = candidate.replace(/[.,;:!?]+$/, "");
  for (const [opening, closing] of [["(", ")"], ["[", "]"], ["{", "}"]]) {
    while (
      trimmed.endsWith(closing) &&
      trimmed.split(closing).length > trimmed.split(opening).length
    ) {
      trimmed = trimmed.slice(0, -1);
    }
  }

  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Return the first HTTP(S) URL from an Android text share. */
export function extractSharedUrl(webUrl?: string | null, text?: string | null): string | null {
  if (webUrl) {
    const fromWeb = normalizeSharedUrl(webUrl);
    if (fromWeb) return fromWeb;
  }
  const fromText = firstHttpUrl(text);
  return fromText ? normalizeSharedUrl(fromText) : null;
}
