/**
 * Overlay mode that returns to idle when visibility flips. Apply during
 * render (not in an effect): leftover delete/edit would otherwise commit,
 * snap overlay presence open, and flash ConfirmDialog on the next long-press.
 */
import { useState } from "react";

export function overlaySessionMode<Mode extends string>(
  visible: boolean,
  wasVisible: boolean,
  mode: Mode,
  idle: Mode,
): { wasVisible: boolean; mode: Mode } {
  if (visible === wasVisible) return { wasVisible, mode };
  return { wasVisible: visible, mode: idle };
}

export function useOverlaySessionMode<Mode extends string>(visible: boolean, idle: Mode) {
  const [mode, setMode] = useState<Mode>(idle);
  const [wasVisible, setWasVisible] = useState(visible);
  const next = overlaySessionMode(visible, wasVisible, mode, idle);
  if (next.wasVisible !== wasVisible) setWasVisible(next.wasVisible);
  if (next.mode !== mode) setMode(next.mode);
  return [next.mode, setMode] as const;
}
