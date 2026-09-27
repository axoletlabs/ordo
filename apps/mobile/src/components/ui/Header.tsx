/**
 * Screen header with optional back button, title, and trailing action.
 * Large tab headers and compact pushed headers share one title slot so
 * "Bookmarks" and a folder name sit on the same line when you navigate.
 *
 * Side controls center on the title line. A subtitle hangs below that line
 * and does not move the back button or the trailing icons.
 */
import React from "react";
import {
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { measureAnchor, type MenuAnchorRect } from "../../lib/menu-anchor";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PressableScale } from "./PressableScale";
import { Text } from "./Text";
import { useTheme } from "../../theme/ThemeProvider";
import { haptics } from "../../lib/haptics";
import { dismissKeyboard } from "../../hooks/use-keyboard-visible";
import {
  CHEVRON_BACK_ICON_SIZE,
  chevronBackTipShift,
  columnContentInset,
} from "../../theme/alignment";
import { layout, spacing } from "../../theme/tokens";
import { useResponsiveLayout } from "../../hooks/use-responsive-layout";

/** Matches `Text` variant "header" line height (14px × 1.5). */
export const HEADER_LINE_HEIGHT = 21;
/** Square hit target for header icon buttons, including back. */
export const HEADER_CONTROL_SIZE = 32;
/**
 * Clears three trailing actions (mark-all, sort, more). Symmetric so the
 * title stays on the screen center and does not run under the icons.
 */
export const HEADER_TITLE_INSET = HEADER_CONTROL_SIZE * 3;
/** Puts the chevron tip on the screen rail (the control's leading edge). */
const BACK_CHEVRON_SHIFT = chevronBackTipShift(HEADER_CONTROL_SIZE);
/** Trailing header glyphs (back chevron stays 24). */
export const HEADER_ICON_SIZE = 22;
/**
 * Ionicons share one em-square, but some glyphs fill more of it than others.
 * Shrink the heavy ones so a header row matches optically.
 */
const HEADER_ICON_OPTICAL_SIZE: Partial<Record<keyof typeof Ionicons.glyphMap, number>> = {
  "pricetag-outline": 18,
  "pricetags-outline": 18,
};

function headerIconSize(name: keyof typeof Ionicons.glyphMap): number {
  return HEADER_ICON_OPTICAL_SIZE[name] ?? HEADER_ICON_SIZE;
}

export const headerTitleTextStyle: TextStyle = {
  width: "100%",
  includeFontPadding: false,
  textAlignVertical: "center",
};

const headerIconGlyphStyle: TextStyle = {
  includeFontPadding: false,
  textAlignVertical: "center",
};

export interface HeaderProps {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  onBack?: () => void;
  right?: React.ReactNode;
  large?: boolean;
  safeTop?: boolean;
  maxWidth?: number;
  /** Hairline under the header so scrolling content does not collide with it. */
  divider?: boolean;
  onTitleLongPress?: () => void;
  titleAccessibilityHint?: string;
}

export function Header({
  title,
  subtitle,
  showBack,
  onBack,
  right,
  large,
  safeTop = true,
  maxWidth = layout.maxContentWidth,
  divider = false,
  onTitleLongPress,
  titleAccessibilityHint,
}: HeaderProps) {
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const { isLandscape, isTablet } = useResponsiveLayout();
  const router = useRouter();
  const topInset = safeTop ? insets.top : 0;
  // Same rail as section labels, cards, and list hairlines.
  const sidePad = columnContentInset(insets.left, windowWidth, maxWidth);
  const endPad = columnContentInset(insets.right, windowWidth, maxWidth);
  const showLarge = large && (!isLandscape || isTablet);

  const handleBack = () => {
    dismissKeyboard();
    haptics.light();
    if (onBack) onBack();
    else if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  const titleEl = (
    <Text variant="header" align="center" numberOfLines={1} style={headerTitleTextStyle}>
      {title}
    </Text>
  );
  const titleBlock = onTitleLongPress ? (
    <Pressable
      onLongPress={onTitleLongPress}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={titleAccessibilityHint}
      style={styles.titleHit}
    >
      {titleEl}
    </Pressable>
  ) : (
    titleEl
  );

  return (
    <View
      style={[
        styles.wrap,
        {
          maxWidth,
          paddingTop: topInset + spacing[4],
          paddingBottom: layout.headerContentGap,
          paddingLeft: sidePad,
          paddingRight: endPad,
          borderBottomColor: palette.border,
          borderBottomWidth: divider ? StyleSheet.hairlineWidth : 0,
        },
      ]}
    >
      <View style={styles.cluster} pointerEvents="box-none">
        <View style={styles.titleBand}>
          <View pointerEvents={onTitleLongPress ? "auto" : "none"} style={styles.titleSlot}>
            {titleBlock}
          </View>
          <View style={styles.sides} pointerEvents="box-none">
            <View style={styles.sideSlot} pointerEvents="box-none">
              {!showLarge && showBack ? (
                <PressableScale
                  style={styles.backBtn}
                  scaleTo={0.85}
                  onPress={handleBack}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Back"
                >
                  <View style={styles.backGlyph} pointerEvents="none">
                    <Ionicons
                      name="chevron-back"
                      size={CHEVRON_BACK_ICON_SIZE}
                      color={palette.text}
                      style={headerIconGlyphStyle}
                    />
                  </View>
                </PressableScale>
              ) : null}
            </View>
            <View style={[styles.sideSlot, styles.sideSlotEnd]} pointerEvents="box-none">
              {right}
            </View>
          </View>
        </View>
        {subtitle ? (
          <Text
            variant="footnote"
            color="secondary"
            align="center"
            numberOfLines={1}
            style={styles.subtitle}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** Row of trailing header controls; keeps mixed icons/labels on one baseline. */
export function HeaderActions({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.actions, style]}>{children}</View>;
}

export function HeaderIconButton({
  name,
  color,
  onPress,
  accessibilityLabel,
  accessibilityHint,
}: {
  name: keyof typeof Ionicons.glyphMap;
  color: string;
  onPress: (anchor: MenuAnchorRect) => void;
  accessibilityLabel: string;
  accessibilityHint?: string;
}) {
  const anchorRef = React.useRef<View>(null);
  return (
    <View ref={anchorRef} collapsable={false}>
      <PressableScale
        style={styles.iconBtn}
        scaleTo={0.85}
        onPress={(event) => {
          haptics.light();
          measureAnchor(anchorRef.current, onPress, event);
        }}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
      >
        <Ionicons name={name} size={headerIconSize(name)} color={color} style={headerIconGlyphStyle} />
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: "100%",
    alignSelf: "center",
    overflow: "visible",
  },
  cluster: {
    justifyContent: "flex-start",
    overflow: "visible",
  },
  // Only the title line. Controls overlay this band, so a subtitle cannot
  // pull them down.
  titleBand: {
    position: "relative",
    minHeight: HEADER_LINE_HEIGHT,
    justifyContent: "center",
    overflow: "visible",
  },
  titleSlot: {
    minHeight: HEADER_LINE_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: HEADER_TITLE_INSET,
  },
  titleHit: { width: "100%", justifyContent: "center" },
  subtitle: {
    width: "100%",
    marginTop: spacing[2],
    paddingHorizontal: HEADER_TITLE_INSET,
    includeFontPadding: false,
    textAlignVertical: "center",
  },
  sides: {
    ...StyleSheet.absoluteFill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sideSlot: {
    minHeight: HEADER_CONTROL_SIZE,
    justifyContent: "center",
  },
  sideSlotEnd: { alignItems: "flex-end" },
  side: {
    position: "absolute",
    top: 0,
    height: "100%",
    flexDirection: "row",
    alignItems: "center",
    zIndex: 1,
  },
  sideLeft: { left: 0 },
  sideRight: { right: 0 },
  backBtn: {
    width: HEADER_CONTROL_SIZE,
    height: HEADER_CONTROL_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  backGlyph: {
    transform: [{ translateX: BACK_CHEVRON_SHIFT }],
  },
  iconBtn: {
    width: HEADER_CONTROL_SIZE,
    height: HEADER_CONTROL_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  actions: { flexDirection: "row", alignItems: "center" },
});

/** Stretch a side control across the title cluster and center it. */
export const headerSideStyle = styles.side;
