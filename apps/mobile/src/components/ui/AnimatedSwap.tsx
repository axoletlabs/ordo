import React, { useState } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import Animated from "react-native-reanimated";
import { useOverlayPage } from "../../hooks/use-overlay-page";
import { useSurfaceSize } from "../../hooks/use-surface-size";

/** Reveal and fit the incoming state together, without delaying measurement.
 * Use for mutually exclusive states; persistent editors keep their own tree. */
export function AnimatedSwap({ transitionKey, children, style }: {
  transitionKey: string; children: React.ReactNode; style?: StyleProp<ViewStyle>;
}) {
  const page = useOverlayPage(true, transitionKey, children);
  const [height, setHeight] = useState<number | null>(null);
  const size = useSurfaceSize(height);
  return <Animated.View style={[style, size]}>
    <Animated.View style={[{ flexShrink: 0 }, page.style]} onLayout={event => {
        const next = event.nativeEvent.layout.height;
        setHeight(current => current != null && Math.abs(current - next) < 0.5 ? current : next);
      }}><View style={{ flexShrink: 0 }}>{page.content}</View></Animated.View>
  </Animated.View>;
}
