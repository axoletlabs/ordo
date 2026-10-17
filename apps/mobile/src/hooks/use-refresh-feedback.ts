import { useCallback, useEffect, useRef, useState } from "react";
import { refreshHoldRemaining } from "../lib/refresh-feedback";

/** User-initiated refresh feedback, including synchronous/cache-fast completions. */
export function useRefreshFeedback() {
  const [refreshing, setRefreshing] = useState(false);
  const active = useRef(false);
  const started = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; clearTimeout(timer.current); };
  }, []);
  const start = useCallback(() => {
    if (active.current || !mounted.current) return false;
    active.current = true;
    started.current = Date.now();
    clearTimeout(timer.current);
    setRefreshing(true);
    return true;
  }, []);
  const finish = useCallback(() => {
    if (!active.current || !mounted.current) return;
    clearTimeout(timer.current);
    const settle = () => {
      active.current = false;
      if (mounted.current) setRefreshing(false);
    };
    const remaining = refreshHoldRemaining(started.current, Date.now());
    if (remaining) timer.current = setTimeout(settle, remaining);
    else settle();
  }, []);
  return { refreshing, start, finish };
}
