/** Material small / large top app bars with shared 48dp action targets. */
import React from "react";
import { Platform, StyleSheet, View, type GestureResponderEvent, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { useAppRouter as useRouter } from "../../hooks/use-app-router";
import { MaterialIcon as Ionicons } from "./MaterialIcon";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColumnPadding, type ColumnAlign } from "../../hooks/use-scene-column-insets";
import { useResponsiveLayout } from "../../hooks/use-responsive-layout";
import { measureAnchor, type MenuAnchorRect } from "../../lib/menu-anchor";
import { createMenuAnchorPress } from "../../lib/menu-anchor-press";
import { dismissKeyboard } from "../../hooks/use-keyboard-visible";
import { haptics } from "../../lib/haptics";
import { runPressAction } from "../../lib/press-action";
import { Text } from "./Text";
import { PressableScale } from "./PressableScale";
import { PlainTooltip } from "./PlainTooltip";
import { useButtonGroupInteraction } from "./ButtonGroup";
import { IconButton } from "./IconButton";
import { useTheme } from "../../theme/ThemeProvider";
import { layout, radius, spacing } from "../../theme/tokens";
import { appBarLayout } from "../../theme/app-bar-layout";

const headerTitleTextStyle: TextStyle = { includeFontPadding: false, textAlignVertical: "center" };
export interface HeaderProps {
  title: string; subtitle?: string; showBack?: boolean; onBack?: () => void | boolean; right?: React.ReactNode;
  variant?: "standard" | "tonal";
  large?: boolean; safeTop?: boolean; maxWidth?: number; alignTo?: ColumnAlign; divider?: boolean;
  onTitleLongPress?: () => void; titleAccessibilityHint?: string;
}
export function Header({ title, subtitle, showBack, onBack, right, large, safeTop = true,
  maxWidth = layout.maxContentWidth, alignTo = "scene", divider = false, onTitleLongPress, titleAccessibilityHint, variant = "standard",
}: HeaderProps) {
  const { palette, expressive } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const column = useColumnPadding(maxWidth, alignTo);
  const { compactHeight } = useResponsiveLayout();
  const expanded = large && !compactHeight;
  const barLayout = appBarLayout({ topInset: insets.top, safeTop, compact: compactHeight, tonal: variant === "tonal" });
  const back = () => {
    dismissKeyboard();
    return onBack ? onBack() : router.canGoBack() ? router.back() : router.replace("/");
  };
  const titleText = <Text variant={expanded ? (expressive ? "displaySmall" : "headlineLarge") : variant === "tonal" ? "bodyLarge" : "titleLarge"}
    numberOfLines={1} style={headerTitleTextStyle}>{title}</Text>;
  return (
    <View testID="material-app-bar" style={{ width: "100%", alignSelf: "center", maxWidth,
      paddingTop: barLayout.paddingTop, paddingLeft: column.left, paddingRight: column.right,
      paddingBottom: expanded ? spacing[16] : barLayout.paddingBottom, backgroundColor: palette.background,
      borderBottomColor: palette.outlineVariant, borderBottomWidth: divider ? StyleSheet.hairlineWidth : 0,
    }}>
      <View style={[styles.bar, { minHeight: barLayout.minHeight },
        variant === "tonal" ? { backgroundColor: palette.surfaceContainerHigh, borderRadius: radius.full, paddingHorizontal: spacing[4], gap: spacing[4] } : null]}>
         {showBack ? <HeaderIconButton name="arrow-back" variant="standard" color={palette.onSurface} onPress={back} accessibilityLabel="Back" measureOnPress={false} /> : null}
        {!expanded ? <View style={styles.title}>
          {onTitleLongPress ? <PressableScale onLongPress={onTitleLongPress} accessibilityRole="button"
            accessibilityLabel={title} accessibilityHint={titleAccessibilityHint}
            style={{ minHeight: 48, justifyContent: "center", paddingHorizontal: variant === "tonal" ? spacing[12] : spacing[4], borderRadius: variant === "tonal" ? radius.full : radius.sm }}>{titleText}</PressableScale> : titleText}
          {subtitle ? <Text variant="bodySmall" color="secondary" numberOfLines={1}>{subtitle}</Text> : null}
        </View> : <View style={{ flex: 1 }} />}
        {right}
      </View>
      {expanded ? <View style={{ paddingTop: spacing[8] }}>
        {onTitleLongPress ? <PressableScale onLongPress={onTitleLongPress} accessibilityRole="button"
          accessibilityLabel={title} accessibilityHint={titleAccessibilityHint}
          style={{ minHeight: 48, justifyContent: "center", borderRadius: radius.sm }}>{titleText}</PressableScale> : titleText}
        {subtitle ? <Text variant="bodyMedium" color="secondary" style={{ marginTop: spacing[8] }}>{subtitle}</Text> : null}
      </View> : null}
    </View>
  );
}
export function HeaderActions({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.actions, style]}>{children}</View>;
}
export function HeaderIconButton({ name, color, variant = "standard", onPress, accessibilityLabel, accessibilityHint, measureOnPress = true }: {
  name: keyof typeof Ionicons.glyphMap; color: string; onPress: (anchor: MenuAnchorRect) => void | boolean;
  accessibilityLabel: string; accessibilityHint?: string; variant?: "standard" | "filled" | "tonal" | "outlined";
  measureOnPress?: boolean;
}) {
  const grouped = useButtonGroupInteraction() != null;
  const ref = React.useRef<View>(null);
  const anchorPress = React.useMemo(() => createMenuAnchorPress<GestureResponderEvent>(
    (done, event) => measureAnchor(ref.current, done, event),
  ), []);
  React.useLayoutEffect(() => () => anchorPress.cancel(), [anchorPress]);
  const [tooltip, setTooltip] = React.useState<MenuAnchorRect | null>(null);
  const tooltipId = React.useId();
  const hovered = React.useRef(false);
  const focused = React.useRef(false);
  const tooltipHovered = React.useRef(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = React.useRef(0);
  const dismissTooltip = React.useCallback(() => {
    generation.current += 1;
    if (timer.current) clearTimeout(timer.current);
    setTooltip(null);
  }, []);
  const showTooltip = (transient = false) => {
    const token = ++generation.current;
    if (timer.current) clearTimeout(timer.current);
    measureAnchor(ref.current, (anchor) => {
      if (generation.current !== token) return;
      setTooltip(anchor);
      if (transient) timer.current = setTimeout(dismissTooltip, 2000);
    });
  };
  const scheduleTooltip = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => showTooltip(), 500);
  };
  const hideIfInactive = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { if (!hovered.current && !focused.current && !tooltipHovered.current) dismissTooltip(); }, 200);
  };
  React.useEffect(() => {
    if (!tooltip || Platform.OS !== "web") return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); dismissTooltip(); } };
    document.addEventListener("keydown", escape, true);
    return () => document.removeEventListener("keydown", escape, true);
  }, [tooltip, dismissTooltip]);
  React.useEffect(() => () => { generation.current += 1; if (timer.current) clearTimeout(timer.current); }, []);
  return <><View ref={ref} collapsable={false} style={grouped ? { width: "100%" } : undefined}>
    <IconButton name={name} variant={variant} color={color} accessibilityLabel={accessibilityLabel}
      aria-describedby={tooltip ? tooltipId : undefined}
      accessibilityHint={accessibilityHint}
      onPressIn={measureOnPress ? (event) => { dismissTooltip(); anchorPress.prepare(event); } : undefined}
      onPressOut={measureOnPress ? () => anchorPress.release() : undefined}
      onHoverIn={() => { hovered.current = true; scheduleTooltip(); }} onFocus={() => { focused.current = true; scheduleTooltip(); }}
      onHoverOut={() => { hovered.current = false; hideIfInactive(); }} onBlur={() => { focused.current = false; hideIfInactive(); }}
      onLongPress={() => { anchorPress.cancel(); showTooltip(Platform.OS !== "web"); }}
      onPress={(event) => {
        dismissTooltip();
        const invoke = (anchor: MenuAnchorRect) => runPressAction(() => onPress(anchor), haptics.light);
        if (measureOnPress) anchorPress.activate(event, invoke);
        else invoke({ x: 0, y: 0, width: 1, height: 1 });
      }} />
   </View><PlainTooltip id={tooltipId} visible={!!tooltip} anchor={tooltip} label={accessibilityLabel} onDismiss={dismissTooltip}
     onHoverIn={() => { tooltipHovered.current = true; if (timer.current) clearTimeout(timer.current); }}
     onHoverOut={() => { tooltipHovered.current = false; hideIfInactive(); }} /></>;
}
const styles = StyleSheet.create({
  bar: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: spacing[8] },
  title: { flex: 1, minWidth: 0 },
  actions: { flexDirection: "row", alignItems: "center" },
});
