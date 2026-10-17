/**
 * Full-bleed feedback behind a library row: the tonal surface, the selection
 * tone and the hover/press state layer. In Expressive mode the surface's
 * corners lift under the pointer (see useRowLift) — the row container stops
 * clipping so the morph is visible; in Standard mode everything is static.
 */
import React from "react";
import { Animated, StyleSheet } from "react-native";
import { useTheme } from "../../theme/ThemeProvider";
import { alphaTint } from "../../theme/state-layer";
import { useMaterialMotion } from "../../theme/material-motion";
import { useRowCornerStyle, useRowLift, type CornerRadii } from "../../theme/row-shape";
import { useStateVisibility } from "../ui/StateLayer";

export function RowHighlight({ rest, expressive, hovered, pressed, selected, hoverRadius, pressRadius, selectionMode = false }: {
  rest?: CornerRadii; expressive: boolean; hovered: boolean; pressed: boolean; selected: boolean;
  hoverRadius?: number; pressRadius?: number;
  selectionMode?: boolean;
}) {
  const { palette } = useTheme();
  const { reducedMotion } = useMaterialMotion();
  // Opacity shares each view's graph with the JS-driven corner morph. Keep
  // both on JS, even in Standard mode, so toggling Expressive stays safe.
  // Range and Select all feedback is immediate, not dozens of JS springs that
  // continue chasing already-obsolete selection states after the finger lifts.
  const selection = useStateVisibility(selected, false, selected, selectionMode);
  const feedback = useStateVisibility(pressed || hovered, false);
  const lift = useRowLift({ expressive, hovered, pressed, selected, hoverRadius, pressRadius, reducedMotion, immediate: selectionMode });
  const morph = useRowCornerStyle(lift, expressive ? rest : undefined);
  // Static rest corners under the interpolations: before the first animation
  // frame RN-web has not written the dynamic style yet, and the surface must
  // still render its group silhouette.
  const restStyle = rest ? { ...rest } : null;
  return <>
    {expressive && rest ? <Animated.View testID="material-row-surface" pointerEvents="none" accessible={false}
      style={[StyleSheet.absoluteFill, restStyle, morph, { backgroundColor: palette.surfaceContainerLow }]} /> : null}
    <Animated.View testID="material-row-selection" pointerEvents="none" accessible={false}
      style={[StyleSheet.absoluteFill, restStyle, morph, { backgroundColor: palette.secondaryContainer, opacity: selection }]} />
    <Animated.View testID="material-row-state-layer" pointerEvents="none" accessible={false}
      style={[StyleSheet.absoluteFill, restStyle, morph, { backgroundColor: alphaTint(palette.onSurface, pressed ? 0.1 : 0.08), opacity: feedback }]} />
  </>
  ;
}
