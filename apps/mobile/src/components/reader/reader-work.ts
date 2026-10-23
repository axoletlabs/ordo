import { scheduleIdleWork } from "../../lib/idle-work";

/** JS idle does not mean the native scroller is idle. Keep article expansion
 * and Contents preparation out of active drags/flings without React updates.
 *
 * Only one queued job is armed at a time. Running one job and then scheduling
 * the next through scheduleIdleWork gives React another frame to paint before
 * the following idle opportunity, instead of letting every pending job share
 * one idle deadline. */
export function createReaderWorkScheduler() {
  interface PendingWork {
    work: () => void;
    cancelIdle?: () => void;
  }
  const pending = new Map<() => void, PendingWork>();
  let scheduled: PendingWork | null = null;
  let running = false;
  let scrollTimer: ReturnType<typeof setTimeout> | undefined;

  const scheduleNext = () => {
    if (running || scrollTimer || scheduled || pending.size === 0) return;
    const entry = pending.values().next().value!;
    scheduled = entry;
    entry.cancelIdle = scheduleIdleWork(() => {
      if (scheduled !== entry) return;
      scheduled = null;
      entry.cancelIdle = undefined;
      if (pending.get(entry.work) === entry) pending.delete(entry.work);
      running = true;
      try {
        entry.work();
      } finally {
        running = false;
        scheduleNext();
      }
    });
  };

  const cancel = (entry: PendingWork) => {
    if (pending.get(entry.work) !== entry) return;
    pending.delete(entry.work);
    if (scheduled === entry) {
      scheduled = null;
      entry.cancelIdle?.();
      entry.cancelIdle = undefined;
    }
    if (!running) scheduleNext();
  };

  const resume = () => {
    if (!scrollTimer) return;
    clearTimeout(scrollTimer);
    scrollTimer = undefined;
    scheduleNext();
  };

  return {
    schedule(work: () => void) {
      // The Map dedupes the same callback while it is queued. A running job is
      // removed before invocation, so scheduling it again queues a new turn.
      let entry = pending.get(work);
      if (!entry) {
        entry = { work };
        pending.set(work, entry);
        if (!running) scheduleNext();
      }
      const queued = entry;
      return () => cancel(queued);
    },
    scrolling() {
      if (!scrollTimer) {
        if (scheduled) {
          scheduled.cancelIdle?.();
          scheduled.cancelIdle = undefined;
          scheduled = null;
        }
      } else clearTimeout(scrollTimer);
      scrollTimer = setTimeout(resume, 180);
    },
    // A fast reader needs a runway: don't pause expansion near the end of the
    // currently mounted content, even if a fling is still in progress.
    resume,
    dispose() {
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = undefined;
      if (scheduled) {
        scheduled.cancelIdle?.();
        scheduled.cancelIdle = undefined;
        scheduled = null;
      }
      pending.clear();
    },
  };
}

export type ReaderWorkScheduler = ReturnType<typeof createReaderWorkScheduler>;
