import { scheduleIdleWork } from "../../lib/idle-work";

/** JS idle does not mean the native scroller is idle. Keep article expansion
 * and Contents preparation out of active drags/flings without React updates. */
export function createReaderWorkScheduler() {
  const pending = new Map<() => void, (() => void) | undefined>();
  let scrollTimer: ReturnType<typeof setTimeout> | undefined;
  const arm = (work: () => void) => scheduleIdleWork(() => {
    pending.delete(work);
    work();
  });
  const resume = () => {
    if (!scrollTimer) return;
    clearTimeout(scrollTimer);
    scrollTimer = undefined;
    pending.forEach((_cancel, work) => pending.set(work, arm(work)));
  };
  return {
    schedule(work: () => void) {
      pending.set(work, scrollTimer ? undefined : arm(work));
      return () => { pending.get(work)?.(); pending.delete(work); };
    },
    scrolling() {
      if (!scrollTimer) {
        pending.forEach((cancel, work) => { cancel?.(); pending.set(work, undefined); });
      } else clearTimeout(scrollTimer);
      scrollTimer = setTimeout(resume, 180);
    },
    // A fast reader needs a runway: don't pause expansion near the end of the
    // currently mounted content, even if a fling is still in progress.
    resume,
    dispose() {
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = undefined;
      pending.forEach((cancel) => cancel?.());
      pending.clear();
    },
  };
}

export type ReaderWorkScheduler = ReturnType<typeof createReaderWorkScheduler>;
