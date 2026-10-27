import React, { useState } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import Animated from "react-native-reanimated";
import { useOverlayPage } from "../../hooks/use-overlay-page";
import { OverlayPageContent } from "./OverlayPageContent";
import { ResizeOwnerContext } from "./resize-owner";
import { useSurfaceSize } from "../../hooks/use-surface-size";

/** Reveal and fit the incoming state together, without delaying measurement.
 * Use for mutually exclusive states; persistent editors keep their own tree. */
export function AnimatedSwap({ transitionKey, children, style }: {
  transitionKey: string; children: React.ReactNode; style?: StyleProp<ViewStyle>;
}) {
  const page = useOverlayPage(true, transitionKey, children);
  const [height, setHeight] = useState<number | null>(null);
  const owned = React.useContext(ResizeOwnerContext);
  const size = useSurfaceSize(owned ? null : height);
  return <Animated.View style={[style, { overflow: "hidden", flexShrink: 0 }, size]}>
    <OverlayPageContent leaving={page.leaving} style={[{ flexShrink: 0 }, page.style]} onLayout={event => {
        const next = event.nativeEvent.layout.height;
        setHeight(current => current != null && Math.abs(current - next) < 0.5 ? current : next);
      }}><ResizeOwnerContext.Provider value><View style={{ flexShrink: 0 }}>{page.content}</View></ResizeOwnerContext.Provider></OverlayPageContent>
  </Animated.View>;
}
