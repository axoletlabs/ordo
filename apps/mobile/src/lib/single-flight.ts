/** Share an operation across mounted consumers and rapid repeated taps. */
export function singleFlight<T>(run: () => Promise<T>): () => Promise<T> {
  let active: Promise<T> | null = null;
  return () => {
    if (active) return active;
    const request = Promise.resolve().then(run).finally(() => {
      if (active === request) active = null;
    });
    active = request;
    return request;
  };
}
