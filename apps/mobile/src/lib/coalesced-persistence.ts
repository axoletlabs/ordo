/** Serialize writes to one resource, keeping only the latest queued snapshot.
 * Deletion must use this same writer so an older save cannot restore cleared
 * credentials. Each caller settles after its write or its replacement finishes. */
export function createCoalescedPersistence<T>(write: (value: T) => Promise<void>) {
  let pending: { value: T; done: (() => void)[] } | undefined;
  let running = false;
  const drain = async () => {
    running = true;
    while (pending) {
      const entry = pending;
      pending = undefined;
      try { await write(entry.value); }
      catch { /* Persistence is best effort; a failure cannot wedge later saves. */ }
      entry.done.forEach(resolve => resolve());
    }
    running = false;
  };
  return (value: T) => new Promise<void>(resolve => {
    if (pending) { pending.value = value; pending.done.push(resolve); }
    else pending = { value, done: [resolve] };
    if (!running) void drain();
  });
}
