import React, { useLayoutEffect, useRef, useState } from "react";
import { Platform, View, type StyleProp, type ViewStyle } from "react-native";
import Animated from "react-native-reanimated";
import { useOverlayPage } from "../../hooks/use-overlay-page";
import { useSurfaceSize } from "../../hooks/use-surface-size";

/** Fade through committed content, then smoothly fit the incoming page.
 * Use for mutually exclusive states; persistent editors keep their own tree. */
export function AnimatedSwap({ transitionKey, children, style }: {
  transitionKey: string; children: React.ReactNode; style?: StyleProp<ViewStyle>;
}) {
  const page = useOverlayPage(true, transitionKey, children);
  const [height, setHeight] = useState<number | null>(null);
  const size = useSurfaceSize(height);
  const ref = useRef<View>(null);
  useLayoutEffect(() => {
    if (Platform.OS === "web" && ref.current) (ref.current as unknown as HTMLElement).inert = page.leaving;
  }, [page.leaving]);
  return <Animated.View style={[style, size]}>
    <Animated.View ref={ref} pointerEvents={page.leaving ? "none" : "auto"}
      aria-hidden={page.leaving} accessibilityElementsHidden={page.leaving}
      importantForAccessibility={page.leaving ? "no-hide-descendants" : "auto"}
      style={[{ flexShrink: 0 }, page.style]} onLayout={event => {
        const next = event.nativeEvent.layout.height;
        setHeight(current => current != null && Math.abs(current - next) < 0.5 ? current : next);
      }}><View style={{ flexShrink: 0 }}>{page.content}</View></Animated.View>
  </Animated.View>;
}
