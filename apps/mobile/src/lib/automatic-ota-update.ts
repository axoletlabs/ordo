/** Startup is the only safe automatic reload window. Late work stays cached. */
export type OtaLaunchPhase = "checking" | "downloading" | "applying" | null;

export const OTA_CHECK_BUDGET_MS = 2_500;
export const OTA_DOWNLOAD_BUDGET_MS = 15_000;
const RECHECK_MS = 60 * 60 * 1000;
const RETRY_MS = 60 * 1000;

interface AutomaticOtaOptions {
  enabled: boolean;
  alreadyRestarted: boolean;
  isPending: () => boolean;
  canApply: () => boolean;
  check: () => Promise<boolean>;
  download: () => Promise<boolean>;
  restart: () => Promise<void>;
}

export function createAutomaticOtaUpdater(options: AutomaticOtaOptions) {
  let phase: OtaLaunchPhase = options.enabled && !options.alreadyRestarted ? "checking" : null;
  let started = false;
  let active: Promise<void> | null = null;
  let nextCheckAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  const setPhase = (next: OtaLaunchPhase) => {
    phase = next;
    listeners.forEach((listener) => listener());
  };
  const release = () => {
    clearTimeout(timer);
    setPhase(null);
  };
  const budget = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(release, ms);
  };

  const run = (startup: boolean): Promise<void> => {
    if (active) return active;
    // Single flight includes the entire check → download → reload chain.
    active = Promise.resolve().then(async () => {
      try {
        let pending = startup && options.isPending();
        if (!pending) {
          if (startup) budget(OTA_CHECK_BUDGET_MS);
          const available = await options.check();
          if (available) {
            // A slow check must never re-cover an already usable app.
            if (startup && phase !== null) {
              setPhase("downloading");
              budget(OTA_DOWNLOAD_BUDGET_MS);
            }
            pending = await options.download();
          }
        }
        nextCheckAt = Date.now() + RECHECK_MS;
        if (startup && phase !== null && pending && options.canApply()) {
          clearTimeout(timer);
          setPhase("applying");
          await options.restart();
        }
      } catch {
        // Offline/check/download/reload failures never strand the launch screen
        // or produce unsolicited error prompts. Manual retry lives in About.
        nextCheckAt = Date.now() + RETRY_MS;
      } finally {
        release();
        active = null;
      }
    });
    return active;
  };

  return {
    getSnapshot: () => phase,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    start: () => {
      if (started || !options.enabled) return;
      started = true;
      // Do not check/reload again after an OTA restart (including rollbacks).
      if (!options.alreadyRestarted) void run(true);
      else nextCheckAt = Date.now() + RECHECK_MS;
    },
    refresh: () => {
      if (!started || !options.enabled || Date.now() < nextCheckAt) return;
      void run(false);
    },
    // Backgrounding closes the safe reload window permanently for this launch.
    release,
  };
}
