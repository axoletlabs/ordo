/**
 * Cover used while the JS runtime is replaced (OTA apply, server switch).
 *
 * `Updates.reloadAsync()` with no options paints Expo's default reload screen:
 * white background and a #007aff spinner. That is the flash after Restart.
 * Native image layout also treats width/height as dp, so a raw `require()`
 * (pixel size) would jump the mark. Keep the mark at splash dp instead.
 */
export const SPLASH_LOGO_WIDTH = 120;
export const SPLASH_LOGO_ASPECT = 468 / 509;
export const SPLASH_LOGO_HEIGHT = SPLASH_LOGO_WIDTH / SPLASH_LOGO_ASPECT;

/** Covers older than this are ignored so a killed restart cannot skip a later cold launch. */
export const RESTART_COVER_MAX_AGE_MS = 30_000;

export interface RestartCover {
  background: string;
  mode: "light" | "dark";
  at: number;
}

export interface RuntimeReloadScreenOptions {
  backgroundColor: string;
  fade: false;
  imageResizeMode: "contain";
  imageFullScreen: false;
  spinner: { enabled: false; color: string };
  image?: {
    url: string;
    width: number;
    height: number;
    scale: 1;
  };
}

export function serializeRestartCover(
  cover: Pick<RestartCover, "background" | "mode">,
  at = Date.now(),
): string {
  return JSON.stringify({ background: cover.background, mode: cover.mode, at });
}

export function parseRestartCover(
  raw: string | null | undefined,
  now = Date.now(),
): RestartCover | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<RestartCover>;
    if (
      typeof parsed.background !== "string" ||
      (parsed.mode !== "light" && parsed.mode !== "dark") ||
      typeof parsed.at !== "number"
    ) {
      return null;
    }
    if (now - parsed.at > RESTART_COVER_MAX_AGE_MS || now < parsed.at) return null;
    return { background: parsed.background, mode: parsed.mode, at: parsed.at };
  } catch {
    return null;
  }
}

export function buildReloadScreenOptions(
  backgroundColor: string,
  imageUrl?: string | null,
): RuntimeReloadScreenOptions {
  const options: RuntimeReloadScreenOptions = {
    backgroundColor,
    fade: false,
    imageResizeMode: "contain",
    imageFullScreen: false,
    // Image load failure forces a spinner on; tint it to the cover so it
    // cannot flash the default iOS blue on white.
    spinner: { enabled: false, color: backgroundColor },
  };
  if (imageUrl) {
    options.image = {
      url: imageUrl,
      width: SPLASH_LOGO_WIDTH,
      height: SPLASH_LOGO_HEIGHT,
      scale: 1,
    };
  }
  return options;
}
