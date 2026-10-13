import React from "react";
import { StyleSheet, View } from "react-native";
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { MaterialIcon } from "../ui/MaterialIcon";
import { useTheme } from "../../theme/ThemeProvider";
import { materialMotion, useMaterialMotion } from "../../theme/material-motion";

/** A small bookmark tucks into its destination; the row's check confirms success. */
export function BookmarkMoveIndicator({ icon, destination }: {
  icon: keyof typeof MaterialIcon.glyphMap;
  destination: string;
}) {
  const { palette } = useTheme();
  const motion = useMaterialMotion();
  const spatial = useSharedValue(motion.reducedMotion ? 1 : 0);
  const effects = useSharedValue(motion.reducedMotion ? 1 : 0);
  React.useEffect(() => {
    spatial.value = motion.reducedMotion ? 1 : withSpring(1, motion.spatial);
    effects.value = motion.reducedMotion ? 1 : withSpring(1, materialMotion.effects.slow);
    return () => { cancelAnimation(spatial); cancelAnimation(effects); };
  }, [spatial, effects, motion.reducedMotion, motion.spatial]);
  const bookmarkStyle = useAnimatedStyle(() => ({
    opacity: 1 - effects.value,
    transform: [{ translateX: -20 * (1 - spatial.value) }, { translateY: -8 * (1 - spatial.value) }, { scale: 1 - spatial.value * 0.4 }],
  }));
  const folderStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 0.8 + spatial.value * 0.2 }],
  }));
  return <View testID="bookmark-move-feedback" role="status" accessibilityLiveRegion="polite"
    accessibilityLabel={`Moved to ${destination}`} style={styles.slot}>
    <Animated.View style={folderStyle}><MaterialIcon name={icon} size={24} color={palette.onSecondaryContainer} /></Animated.View>
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, bookmarkStyle]}>
      <MaterialIcon name="bookmark" size={20} color={palette.onSecondaryContainer} />
    </Animated.View>
  </View>;
}

const styles = StyleSheet.create({ slot: { width: 24, height: 24, alignItems: "center", justifyContent: "center" } });
