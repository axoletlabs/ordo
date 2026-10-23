import { startTransition, useCallback, useState } from "react";
import { useAnimationActivityEffect } from "../../hooks/use-animation-activity";
import type { ReaderWorkScheduler } from "./reader-work";

/** Prepare bounded reader chrome after article startup, outside drags/flings and
 * blocking overlays. An earlier tap takes the normal urgent path; preparation
 * never delays an open or creates a second surface. */
export function usePreparedReaderOverlay(workScheduler: ReaderWorkScheduler) {
  const [ready, setReady] = useState(false);
  const [prepared, setPrepared] = useState(false);
  const prepare = useCallback(() => setReady(true), []);
  const retain = useCallback(() => setPrepared(true), []);
  useAnimationActivityEffect(useCallback((active: boolean) => {
    if (!active || !ready || prepared) return;
    return workScheduler.schedule(() => startTransition(() => setPrepared(true)));
  }, [prepared, ready, workScheduler]));
  return { prepared, prepare, retain };
}
