import { useDeferredValue, useEffect, useState } from "react";

/** Controls reflect every tap immediately. Reflow the article after a brief
 * pause instead of rebuilding all its sections for intermediate choices.
 * Deferred priority also lets input interrupt that final render. */
export function useReaderPresentation<T>(value: T) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (settled === value) return;
    const timer = setTimeout(() => setSettled(value), 150);
    return () => clearTimeout(timer);
  }, [value, settled]);
  return useDeferredValue(settled);
}
