/** M3 standard button group: 15% expansion, borrowed from adjacent buttons. */
import React, { createContext, useContext, useState } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { useMaterialMotion } from "../../theme/material-motion";

const Interaction = createContext<((pressed: boolean) => void) | null>(null);
export function useButtonGroupInteraction() { return useContext(Interaction); }

export function ButtonGroup({ children, itemWidth = 48, visualInset = 4, gap = 4, style }: {
  children: React.ReactNode; itemWidth?: number; visualInset?: number; gap?: number; style?: StyleProp<ViewStyle>;
}) {
  const [pressedIndex, setPressedIndex] = useState<number | null>(null);
  const motion = useMaterialMotion();
  const items = React.Children.toArray(children);
  const growth = (itemWidth - visualInset * 2) * 0.15;
  return <View style={[{ flexDirection: "row", alignItems: "center", gap }, style]}>
    {items.map((child, index) => {
      const neighbors = pressedIndex === 0 || pressedIndex === items.length - 1 ? 1 : 2;
      const change = !motion.expressive || motion.reducedMotion || pressedIndex == null || items.length < 2 ? 0
        : index === pressedIndex ? growth : Math.abs(index - pressedIndex) === 1 ? -growth / neighbors : 0;
      return <GroupItem key={React.isValidElement(child) ? child.key ?? index : index} width={itemWidth + change}
        onInteraction={(pressed) => setPressedIndex((current) => pressed ? index : current === index ? null : current)}>{child}</GroupItem>;
    })}
  </View>;
}

function GroupItem({ width, children, onInteraction }: { width: number; children: React.ReactNode; onInteraction: (pressed: boolean) => void }) {
  const motion = useMaterialMotion();
  const size = useSharedValue(width);
  React.useEffect(() => {
    size.value = motion.reducedMotion ? width : withSpring(width, motion.fast);
  }, [width, motion.fast, motion.reducedMotion, size]);
  const animated = useAnimatedStyle(() => ({ width: size.value }));
  return <Interaction.Provider value={onInteraction}><Animated.View style={animated}>{children}</Animated.View></Interaction.Provider>;
}
