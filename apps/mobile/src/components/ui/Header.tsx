/**
 * Screen header with optional back button, title, and trailing action.
 * The title is top-left on the icon column, so a tab and the screen it
 * opens share one left edge. The back chevron sits in the gutter to the
 * left of that column and does not push the title. Trailing icons stay on
 * the right of the same row. A subtitle hangs below and does not move them.
 */
import React from "react";
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { measureAnchor, type MenuAnchorRect } from "../../lib/menu-anchor";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColumnPadding, type ColumnAlign } from "../../hooks/use-scene-column-insets";
import { PressableScale } from "./PressableScale";
import { Text } from "./Text";
import { useTheme } from "../../theme/ThemeProvider";
import { haptics } from "../../lib/haptics";
import { dismissKeyboard } from "../../hooks/use-keyboard-visible";
import {
  CHEVRON_BACK_ICON_SIZE,
  CHEVRON_BACK_TIP_INSET,
} from "../../theme/alignment";
import { layout, spacing } from "../../theme/tokens";
import { useResponsiveLayout } from "../../hooks/use-responsive-layout";

/** Matches `Text` variant "header" line height (14px × 1.5). */
export const HEADER_LINE_HEIGHT = 21;
/** Square hit target for header icon buttons, including back. */
export const HEADER_CONTROL_SIZE = 32;
/**
 * Clears three trailing actions when a caller still centers a title.
 * The header itself truncates against the real trailing icons.
 */
export const HEADER_TITLE_INSET = HEADER_CONTROL_SIZE * 3;
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
  /**
   * `scene` aligns to the area beside the side rail. `window` is a
   * full-window overlay. `parent` is a pane that already sits inside a
   * padded column.
   */
  alignTo?: ColumnAlign;
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
  alignTo = "scene",
  divider = false,
  onTitleLongPress,
  titleAccessibilityHint,
}: HeaderProps) {
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();
  const { isLandscape, isTablet } = useResponsiveLayout();
  const router = useRouter();
  const topInset = safeTop ? insets.top : 0;
  const column = useColumnPadding(maxWidth, alignTo);
  const sidePad = column.left;
  const endPad = column.right;
  const showLarge = large && (!isLandscape || isTablet);

  const handleBack = () => {
    dismissKeyboard();
    haptics.light();
    if (onBack) onBack();
    else if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  const titleEl = (
    <Text variant="header" align="left" numberOfLines={1} style={headerTitleTextStyle}>
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
          paddingTop: topInset + layout.headerTopGap,
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
          <View style={styles.leadingGutter} />
          {!showLarge && showBack ? (
            <PressableScale
              style={styles.backBtn}
              scaleTo={0.85}
              onPress={handleBack}
              hitSlop={{ top: 8, bottom: 8, left: 12, right: 2 }}
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
          <View pointerEvents={onTitleLongPress ? "auto" : "none"} style={styles.titleSlot}>
            {titleBlock}
          </View>
          {right ? <View style={styles.trailing}>{right}</View> : null}
        </View>
        {subtitle ? (
          <Text
            variant="footnote"
            color="secondary"
            align="left"
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
  // One row. The gutter is the icon column's inset, so the title lines
  // up with list icons. The back chevron is painted in that gutter.
  titleBand: {
    position: "relative",
    minHeight: HEADER_CONTROL_SIZE,
    flexDirection: "row",
    alignItems: "center",
    overflow: "visible",
  },
  leadingGutter: { width: layout.rowInset },
  titleSlot: {
    flex: 1,
    minWidth: 0,
    minHeight: HEADER_LINE_HEIGHT,
    justifyContent: "center",
  },
  titleHit: { alignSelf: "stretch", justifyContent: "center" },
  subtitle: {
    marginTop: spacing[2],
    paddingLeft: layout.rowInset,
    includeFontPadding: false,
    textAlignVertical: "center",
  },
  trailing: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: spacing[8],
  },
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
    position: "absolute",
    left: 0,
    top: 0,
    width: layout.rowInset,
    height: HEADER_CONTROL_SIZE,
    alignItems: "flex-start",
    justifyContent: "center",
    zIndex: 1,
    overflow: "visible",
  },
  backGlyph: {
    transform: [{ translateX: -CHEVRON_BACK_TIP_INSET }],
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
