/**
 * Screen header with optional back button, title, and trailing action.
 * Large tab headers and compact pushed headers share one title slot so
 * "Bookmarks" and a folder name sit on the same line when you navigate.
 *
 * Side controls are vertically centered on the full title cluster (title plus
 * optional subtitle), not the title line alone.
 */
import React from "react";
import { Pressable, StyleSheet, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { measureAnchor, type MenuAnchorRect } from "../../lib/menu-anchor";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PressableScale } from "./PressableScale";
import { Text } from "./Text";
import { useTheme } from "../../theme/ThemeProvider";
import { haptics } from "../../lib/haptics";
import { layout, spacing } from "../../theme/tokens";
import { useResponsiveLayout } from "../../hooks/use-responsive-layout";

/** Matches `Text` variant "header" line height (14px × 1.5). */
export const HEADER_LINE_HEIGHT = 21;
/** Clears the 36px back control and a pair of 32px trailing icons. */
export const HEADER_TITLE_INSET = 48;
/** Square hit target for header icon buttons. */
export const HEADER_CONTROL_SIZE = 32;
/** Trailing header glyphs (back chevron stays 24). */
export const HEADER_ICON_SIZE = 22;

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
  const { isLandscape, isTablet } = useResponsiveLayout();
  const router = useRouter();
  const topInset = safeTop ? insets.top : 0;
  // Both header sizes share the screen's 16px horizontal padding so titles,
  // controls, and page content align on the same edge.
  const sidePad = Math.max(insets.left, spacing[16]);
  const endPad = Math.max(insets.right, spacing[16]);
  const showLarge = large && (!isLandscape || isTablet);

  const handleBack = () => {
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
          paddingLeft: sidePad,
          paddingRight: endPad,
          borderBottomColor: palette.border,
          borderBottomWidth: divider ? StyleSheet.hairlineWidth : 0,
        },
      ]}
    >
      <View style={styles.cluster} pointerEvents="box-none">
        <View pointerEvents={onTitleLongPress ? "auto" : "none"} style={styles.titleSlot}>
          {titleBlock}
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
                <Ionicons
                  name="chevron-back"
                  size={24}
                  color={palette.text}
                  style={headerIconGlyphStyle}
                />
              </PressableScale>
            ) : null}
          </View>
          <View style={[styles.sideSlot, styles.sideSlotEnd]} pointerEvents="box-none">
            {right}
          </View>
        </View>
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
        <Ionicons name={name} size={HEADER_ICON_SIZE} color={color} style={headerIconGlyphStyle} />
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: "100%",
    alignSelf: "center",
    paddingBottom: spacing[6],
    overflow: "visible",
  },
  cluster: {
    position: "relative",
    justifyContent: "flex-start",
    minHeight: HEADER_CONTROL_SIZE,
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
    includeFontPadding: false,
    textAlignVertical: "center",
  },
  sides: {
    ...StyleSheet.absoluteFillObject,
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
    width: 36,
    height: HEADER_CONTROL_SIZE,
    alignItems: "center",
    justifyContent: "center",
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
