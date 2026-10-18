/** Serialize by resource, coalescing intermediate values while a write is in flight.
 * Only the latest response may reconcile optimistic state. Failures never wedge
 * the queue; callers decide how to report/retry best-effort writes.
 */
export function createLatestWriteQueue<T, R>(
  write: (value: T) => Promise<R>,
  commit: (result: R, value: T) => void,
) {
  type Entry = { revision: number; pending?: T; running: boolean };
  const entries = new Map<string, Entry>();
  const drain = async (key: string, entry: Entry) => {
    entry.running = true;
    while (entry.pending !== undefined) {
      const value = entry.pending;
      const revision = entry.revision;
      entry.pending = undefined;
      try {
        const result = await write(value);
        if (entry.revision === revision) commit(result, value);
      } catch {
        // A failed old write must not prevent the newest queued value from saving.
      }
    }
    entries.delete(key);
  };
  return (key: string, value: T) => {
    const entry = entries.get(key) ?? { revision: 0, running: false };
    entries.set(key, entry);
    entry.revision += 1;
    entry.pending = value;
    if (!entry.running) void drain(key, entry);
  };
}
