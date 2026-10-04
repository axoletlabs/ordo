/** Material small / large top app bars with shared 48dp action targets. */
import React from "react";
import { StyleSheet, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { useAppRouter as useRouter } from "../../hooks/use-app-router";
import { MaterialIcon as Ionicons } from "./MaterialIcon";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColumnPadding, type ColumnAlign } from "../../hooks/use-scene-column-insets";
import { useResponsiveLayout } from "../../hooks/use-responsive-layout";
import { measureAnchor, type MenuAnchorRect } from "../../lib/menu-anchor";
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

export const HEADER_LINE_HEIGHT = 28;
export const HEADER_CONTROL_SIZE = 48;
export const HEADER_TITLE_INSET = 96;
export const HEADER_ICON_SIZE = 24;
export const headerTitleTextStyle: TextStyle = { includeFontPadding: false, textAlignVertical: "center" };
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
  const back = () => {
    dismissKeyboard();
    return onBack ? onBack() : router.canGoBack() ? router.back() : router.replace("/");
  };
  const titleText = <Text variant={expanded ? (expressive ? "displaySmall" : "headlineLarge") : variant === "tonal" ? "bodyLarge" : "titleLarge"}
    numberOfLines={1} style={headerTitleTextStyle}>{title}</Text>;
  return (
    <View style={{ width: "100%", alignSelf: "center", maxWidth,
      paddingTop: (safeTop ? insets.top : 0) + spacing[8], paddingLeft: column.left, paddingRight: column.right,
      paddingBottom: expanded ? spacing[16] : spacing[8], backgroundColor: palette.background,
      borderBottomColor: palette.outlineVariant, borderBottomWidth: divider ? StyleSheet.hairlineWidth : 0,
    }}>
      <View style={[styles.bar, compactHeight || variant === "tonal" ? { minHeight: 56 } : null,
        variant === "tonal" ? { backgroundColor: palette.surfaceContainerHigh, borderRadius: radius.full, paddingHorizontal: spacing[4], gap: spacing[4] } : null]}>
         {showBack ? <HeaderIconButton name="arrow-back" variant="standard" color={palette.onSurface} onPress={back} accessibilityLabel="Back" measureOnPress={false} /> : null}
        {!expanded ? <View style={styles.title}>
          {onTitleLongPress ? <PressableScale onLongPress={onTitleLongPress} accessibilityRole="button"
            accessibilityLabel={title} accessibilityHint={titleAccessibilityHint}>{titleText}</PressableScale> : titleText}
          {subtitle ? <Text variant="bodySmall" color="secondary" numberOfLines={1}>{subtitle}</Text> : null}
        </View> : <View style={{ flex: 1 }} />}
        {right}
      </View>
      {expanded ? <View style={{ paddingTop: spacing[8] }}>
        {onTitleLongPress ? <PressableScale onLongPress={onTitleLongPress} accessibilityRole="button"
          accessibilityLabel={title} accessibilityHint={titleAccessibilityHint}>{titleText}</PressableScale> : titleText}
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
  const [tooltip, setTooltip] = React.useState<MenuAnchorRect | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = React.useRef(0);
  const dismissTooltip = React.useCallback(() => {
    generation.current += 1;
    if (timer.current) clearTimeout(timer.current);
    setTooltip(null);
  }, []);
  const showTooltip = () => {
    const token = ++generation.current;
    if (timer.current) clearTimeout(timer.current);
    measureAnchor(ref.current, (anchor) => {
      if (generation.current !== token) return;
      setTooltip(anchor);
      timer.current = setTimeout(() => setTooltip(null), 2000);
    });
  };
  const scheduleTooltip = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(showTooltip, 500);
  };
  React.useEffect(() => () => { generation.current += 1; if (timer.current) clearTimeout(timer.current); }, []);
  return <><View ref={ref} collapsable={false} style={grouped ? { width: "100%" } : undefined}>
    <IconButton name={name} variant={variant} color={color} accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint} onHoverIn={scheduleTooltip} onFocus={scheduleTooltip}
      onHoverOut={dismissTooltip} onBlur={dismissTooltip} onLongPress={showTooltip}
      onPress={(event) => {
        dismissTooltip();
        const invoke = (anchor: MenuAnchorRect) => runPressAction(() => onPress(anchor), haptics.light);
        if (measureOnPress) measureAnchor(ref.current, invoke, event);
        else invoke({ x: 0, y: 0, width: 1, height: 1 });
      }} />
  </View><PlainTooltip visible={!!tooltip} anchor={tooltip} label={accessibilityLabel} onDismiss={dismissTooltip} /></>;
}
const styles = StyleSheet.create({
  bar: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: spacing[8] },
  title: { flex: 1, minWidth: 0 },
  actions: { flexDirection: "row", alignItems: "center" },
  icon: { width: 48, height: 48, borderRadius: radius.full, justifyContent: "center", alignItems: "center" },
});
export const headerSideStyle: ViewStyle = { flexDirection: "row", alignItems: "center" };
