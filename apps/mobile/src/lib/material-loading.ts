/* Copyright 2024 The Android Open Source Project; SPDX-License-Identifier: Apache-2.0 */
/** AndroidX Material3 loading motion adapted for Reanimated; see material-loading.LICENSE. */
import { LOADING_MORPHS } from "./material-loading-shapes";
import { boundedProgress } from "./material-progress";

export const MORPH_INTERVAL = 650;
// Four passes make the 7 × 90° stepped rotation loop without a discontinuity.
export const MORPH_STEPS = LOADING_MORPHS.length * 4;

export function loadingMorphState(clock: number) {
  "worklet";
  // Animation drivers can briefly sample before their start timestamp on web.
  const safeClock = Number.isFinite(clock) ? Math.max(0, clock) : 0;
  const step = Math.floor(safeClock) % MORPH_STEPS;
  const seconds = (safeClock - Math.floor(safeClock)) * MORPH_INTERVAL / 1000;
  // Material's spring: stiffness 200, damping ratio .6, unit mass.
  const omega = Math.sqrt(200);
  const damped = omega * 0.8;
  const response = seconds >= 0.6 ? 1 : 1 - Math.exp(-0.6 * omega * seconds)
    * (Math.cos(damped * seconds) + 0.75 * Math.sin(damped * seconds));
  return { index: step % LOADING_MORPHS.length, progress: boundedProgress(response), rotation: (step + response) * 90 + 90 };
}

export function loadingMorphPath(index: number, progress: number): string {
  "worklet";
  const { from, to } = LOADING_MORPHS[index];
  let path = "";
  for (let i = 0; i < from.length; i += 8) {
    const x = from[i] + (to[i] - from[i]) * progress;
    const y = from[i + 1] + (to[i + 1] - from[i + 1]) * progress;
    if (i === 0) path = `M${x},${y}`;
    path += " C";
    for (let j = 2; j < 8; j++) {
      path += `${from[i + j] + (to[i + j] - from[i + j]) * progress}${j === 7 ? "" : ","}`;
    }
  }
  return `${path} Z`;
}
