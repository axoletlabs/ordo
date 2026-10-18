/** Fetch silently. Expo selects the cached bundle on the next cold launch. */
const RECHECK_MS = 60 * 60 * 1000;
const RETRY_MS = 60 * 1000;

interface AutomaticOtaOptions {
  enabled: boolean;
  check: () => Promise<boolean>;
  download: () => Promise<boolean>;
}

export function createAutomaticOtaUpdater(options: AutomaticOtaOptions) {
  let started = false;
  let active: Promise<void> | null = null;
  let nextCheckAt = 0;
  const run = (): Promise<void> => {
    if (active) return active;
    // Single flight includes check and download, even across root remounts.
    active = Promise.resolve().then(async () => {
      try {
        if (await options.check()) await options.download();
        nextCheckAt = Date.now() + RECHECK_MS;
      } catch {
        // Offline and failed transfers are invisible, too. Keep running the
        // current bundle and retry on a later foreground/connectivity event.
        nextCheckAt = Date.now() + RETRY_MS;
      } finally {
        active = null;
      }
    });
    return active;
  };

  return {
    start: () => {
      if (started || !options.enabled) return;
      started = true;
      void run();
    },
    refresh: () => {
      if (!started || !options.enabled || Date.now() < nextCheckAt) return;
      void run();
    },
  };
}
