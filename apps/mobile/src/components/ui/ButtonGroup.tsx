/** M3 standard button group: 15% expansion, borrowed from adjacent buttons. */
import React, { createContext, useCallback, useContext, useRef, useState } from "react";
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
       const change = motion.reducedMotion || pressedIndex == null || items.length < 2 ? 0
        : index === pressedIndex ? growth : Math.abs(index - pressedIndex) === 1 ? -growth / neighbors : 0;
      return <GroupItem key={React.isValidElement(child) ? child.key ?? index : index} index={index} width={itemWidth + change} motion={motion}
        setPressedIndex={setPressedIndex}>{child}</GroupItem>;
    })}
  </View>;
}

function GroupItem({ index, width, motion, children, setPressedIndex }: {
  index: number; width: number; motion: ReturnType<typeof useMaterialMotion>; children: React.ReactNode;
  setPressedIndex: React.Dispatch<React.SetStateAction<number | null>>;
}) {
  const onInteraction = useCallback((pressed: boolean) => {
    setPressedIndex((current) => pressed ? index : current === index ? null : current);
  }, [index, setPressedIndex]);
  const size = useSharedValue(width);
  const previous = useRef({ width, spring: motion.fast, reducedMotion: motion.reducedMotion });
  React.useLayoutEffect(() => {
    if (previous.current.width === width && previous.current.spring === motion.fast && previous.current.reducedMotion === motion.reducedMotion) return;
    previous.current = { width, spring: motion.fast, reducedMotion: motion.reducedMotion };
    size.value = motion.reducedMotion ? width : withSpring(width, motion.fast);
  }, [width, motion.fast, motion.reducedMotion, size]);
  const animated = useAnimatedStyle(() => ({ width: size.value }));
  return <Interaction.Provider value={onInteraction}><Animated.View style={animated}>{children}</Animated.View></Interaction.Provider>;
}
