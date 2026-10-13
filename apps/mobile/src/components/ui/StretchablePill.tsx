import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, type SharedValue, type AnimatedStyle } from "react-native-reanimated";
import { stretchablePillGeometry } from "../../lib/stretchable-pill";
import { PressableScale, type PressableScaleProps, type PressableSurfaceState } from "./PressableScale";

const HEIGHT = 48;
const CAP = HEIGHT / 2;

/** Resizes without Yoga/text layout on each frame. Only the straight middle
 * stretches; both end caps, icons and labels keep their real Material shape. */
export function StretchablePill({ width, canvasWidth, children, ...props }: Omit<PressableScaleProps, "renderSurface" | "visualStyle" | "children"> & {
  width: SharedValue<number>;
  canvasWidth: number;
  children: React.ReactNode;
}) {
  const hitStyle = useAnimatedStyle(() => {
    const geometry = stretchablePillGeometry(width.value, canvasWidth);
    return { transform: [{ translateX: geometry.shift }, { scaleX: geometry.scale }] };
  });
  return <Animated.View style={[styles.hit, { width: canvasWidth }, hitStyle]}>
    <PressableScale {...props} renderSurface={state => <PillSurface state={state} width={width} canvasWidth={canvasWidth} />}>
      {children}
    </PressableScale>
  </Animated.View>;
}

function PillSurface({ state, width, canvasWidth }: { state: PressableSurfaceState; width: SharedValue<number>; canvasWidth: number }) {
  const counterStyle = useAnimatedStyle(() => {
    const geometry = stretchablePillGeometry(width.value, canvasWidth);
    return { transform: [{ translateX: geometry.inverseShift }, { scaleX: geometry.inverseScale }] };
  });
  const leadingStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: stretchablePillGeometry(width.value, canvasWidth).leadingShift }],
  }));
  const middleStyle = useAnimatedStyle(() => {
    const geometry = stretchablePillGeometry(width.value, canvasWidth);
    return { transform: [{ translateX: geometry.shift }, { scaleX: geometry.middleScale }] };
  });
  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: stretchablePillGeometry(width.value, canvasWidth).shift }],
  }));
  return <Animated.View pointerEvents="none" style={[styles.canvas, counterStyle]}>
    <PillPaint canvasWidth={canvasWidth} fillStyle={state.backgroundStyle} cornerStyle={state.cornerStyle}
      leadingStyle={leadingStyle} middleStyle={middleStyle} />
    <View style={[styles.contentRail, { width: canvasWidth }]}>
      <Animated.View testID="material-pill-content" style={[styles.content, contentStyle]}>{state.children}</Animated.View>
    </View>
    <Animated.View testID="material-pill-state-layer" style={[styles.canvas, state.stateLayerStyle]}>
      <PillPaint canvasWidth={canvasWidth} fillStyle={{ backgroundColor: state.stateLayerColor }} cornerStyle={state.cornerStyle}
        leadingStyle={leadingStyle} middleStyle={middleStyle} />
    </Animated.View>
  </Animated.View>;
}

function PillPaint({ canvasWidth, fillStyle, cornerStyle, leadingStyle, middleStyle }: {
  canvasWidth: number;
  fillStyle?: StyleProp<AnimatedStyle<ViewStyle>>;
  cornerStyle: StyleProp<AnimatedStyle<ViewStyle>>;
  leadingStyle: StyleProp<AnimatedStyle<ViewStyle>>;
  middleStyle: StyleProp<AnimatedStyle<ViewStyle>>;
}) {
  return <>
    <Animated.View testID="material-pill-leading-cap" style={[styles.cap, styles.leading, leadingStyle]}>
      <Animated.View style={[styles.round, fillStyle, cornerStyle]} />
    </Animated.View>
    <Animated.View style={[styles.middle, { width: Math.max(0, canvasWidth - HEIGHT) }, fillStyle, middleStyle]} />
    <View testID="material-pill-trailing-cap" style={[styles.cap, styles.trailing]}>
      <Animated.View style={[styles.round, styles.trailingRound, fillStyle, cornerStyle]} />
    </View>
  </>;
}

const styles = StyleSheet.create({
  hit: { height: HEIGHT },
  canvas: { ...StyleSheet.absoluteFill },
  cap: { position: "absolute", top: 0, width: CAP, height: HEIGHT, overflow: "hidden" },
  round: { width: HEIGHT, height: HEIGHT, borderRadius: CAP },
  leading: { left: 0 },
  trailing: { right: 0 },
  trailingRound: { left: -CAP },
  middle: { position: "absolute", left: CAP, top: 0, height: HEIGHT },
  contentRail: { height: HEIGHT, alignItems: "center", justifyContent: "center" },
  content: { alignItems: "center", justifyContent: "center", gap: 4 },
});
