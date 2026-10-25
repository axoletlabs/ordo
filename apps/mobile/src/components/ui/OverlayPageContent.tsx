import React from "react";
import { Platform, type View, type ViewProps } from "react-native";
import Animated from "react-native-reanimated";

/** A retained outgoing page is painted but cannot receive taps, focus, or
 * accessibility navigation. Keep those rules identical in menus and dialogs. */
export function OverlayPageContent({ leaving = false, children, style, onLayout, testID }: {
  leaving?: boolean;
  children: React.ReactNode;
  style?: React.ComponentProps<typeof Animated.View>["style"];
  onLayout?: ViewProps["onLayout"];
  testID?: string;
}) {
  const ref = React.useRef<View>(null);
  React.useLayoutEffect(() => {
    if (Platform.OS === "web" && ref.current) (ref.current as unknown as HTMLElement).inert = leaving;
  }, [leaving]);
  return <Animated.View ref={ref} style={style} onLayout={onLayout} testID={testID}
    pointerEvents={leaving ? "none" : "auto"} aria-hidden={leaving}
    accessibilityElementsHidden={leaving} importantForAccessibility={leaving ? "no-hide-descendants" : "auto"}>
    {children}
  </Animated.View>;
}
