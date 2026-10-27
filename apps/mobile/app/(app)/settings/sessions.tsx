/**
 * Active sessions / devices list with per-session revoke (optimistic).
 */
import React, { useCallback, useMemo, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { MaterialIcon as Ionicons } from "../../../src/components/ui/MaterialIcon";
import { useColumnPadding } from "../../../src/hooks/use-scene-column-insets";
import {
  SettingsContent,
  SettingsPage,
  SettingsSectionLabel,
} from "../../../src/components/settings/SettingsPage";
import { Text } from "../../../src/components/ui/Text";
import { Badge } from "../../../src/components/ui/Badge";
import { Button } from "../../../src/components/ui/Button";
import { BookmarkListSkeleton } from "../../../src/components/ui/BookmarkListSkeleton";
import { EmptyState } from "../../../src/components/ui/EmptyState";
import { RowIconWell } from "../../../src/components/ui/RowIconWell";
import { ConfirmDialog } from "../../../src/components/ui/ConfirmDialog";
import { ThemedFlatList } from "../../../src/components/ui/ThemedScrollView";
import { useSessions } from "../../../src/hooks/queries";
import { useRevokeSession } from "../../../src/hooks/use-auth-actions";
import { useTheme } from "../../../src/theme/ThemeProvider";
import { materialMotion, useMaterialMotion } from "../../../src/theme/material-motion";
import { useSurfaceSize } from "../../../src/hooks/use-surface-size";
import { listCorners, listPosition, type ListPosition } from "../../../src/theme/list-shape";
import { useReducedMotionPreference } from "../../../src/hooks/use-reduced-motion-preference";
import { timeAgo } from "../../../src/lib/format";
import { errorMessage } from "../../../src/lib/error-message";
import { haptics } from "../../../src/lib/haptics";
import { toast } from "../../../src/components/ui/toast-store";
import { ROW_ICON_GLYPH } from "../../../src/theme/alignment";
import { layout, spacing } from "../../../src/theme/tokens";
import type { SessionDto } from "@ordo/shared";

function deviceLabel(s: SessionDto): string {
  if (s.deviceName) return s.deviceName;
  const ua = s.deviceInfo ?? "";
  if (/iphone/i.test(ua)) return "iPhone";
  if (/ipad/i.test(ua)) return "iPad";
  if (/android/i.test(ua)) return "Android";
  if (/mac/i.test(ua)) return "Mac";
  if (/windows/i.test(ua)) return "Windows";
  if (/linux/i.test(ua)) return "Linux";
  return s.deviceInfo || "This device";
}

function deviceIcon(s: SessionDto): keyof typeof Ionicons.glyphMap {
  if (s.deviceType === "phone") return "phone-portrait-outline";
  if (s.deviceType === "tablet") return "tablet-portrait-outline";
  if (s.deviceType === "desktop") return "desktop-outline";
  if (s.deviceType === "tv") return "tv-outline";
  return "hardware-chip-outline";
}

export default function SessionsScreen() {
  const column = useColumnPadding(layout.maxSettingsWidth);
  const { data: sessions, isLoading, error, refetch } = useSessions();
  const revoke = useRevokeSession();
  const [pendingRevoke, setPendingRevoke] = useState<SessionDto | null>(null);
  const reducedMotion = useReducedMotionPreference();

  /** Revoked rows retained at their list position until their exit settles;
   * a rolled-back revoke restores the live row and the retained copy leaves. */
  const [exiting, setExiting] = useState<{ session: SessionDto; index: number }[]>([]);
  const rows = useMemo(() => {
    const merged = [...(sessions ?? [])];
    const live = new Set(merged.map((session) => session.id));
    for (const row of [...exiting].sort((a, b) => a.index - b.index)) {
      if (live.has(row.session.id)) continue;
      merged.splice(Math.min(row.index, merged.length), 0, row.session);
    }
    return merged;
  }, [sessions, exiting]);
  const exitingIds = useMemo(() => {
    const live = new Set((sessions ?? []).map((session) => session.id));
    return new Set(exiting.filter((row) => !live.has(row.session.id)).map((row) => row.session.id));
  }, [sessions, exiting]);
  const finishExit = useCallback((id: string) => {
    setExiting((current) => current.filter((row) => row.session.id !== id));
  }, []);

  const onRevoke = (session: SessionDto) => {
    haptics.medium();
    if (!reducedMotion) {
      const index = rows.findIndex((row) => row.id === session.id);
      setExiting((current) =>
        current.some((row) => row.session.id === session.id)
          ? current
          : [...current, { session, index: index >= 0 ? index : current.length }],
      );
    }
    revoke.mutate(session.id, {
      onSuccess: () => toast.success("Session revoked"),
      onError: (e) => { finishExit(session.id); toast.error(errorMessage(e)); },
      onSettled: () => setPendingRevoke(null),
    });
  };

  return (
    <SettingsPage title="Active sessions">
      {error && !sessions ? (
        <SettingsContent>
          <EmptyState
            icon="cloud-offline-outline"
            title="Couldn't load sessions"
            message={errorMessage(error)}
            action={<Button label="Retry" onPress={() => refetch()} />}
          />
        </SettingsContent>
      ) : isLoading ? (
        <SettingsContent>
          <SettingsSectionLabel compact>Signed-in devices</SettingsSectionLabel>
          <BookmarkListSkeleton count={3} />
        </SettingsContent>
      ) : (
        <ThemedFlatList
          data={rows}
          keyExtractor={(s) => s.id}
          style={styles.list}
          contentContainerStyle={[
            styles.listContent,
            {
              paddingLeft: column.left,
              paddingRight: column.right,
            },
            rows.length === 0 && styles.listContentEmpty,
          ]}
          ListHeaderComponent={<SettingsSectionLabel compact>Signed-in devices</SettingsSectionLabel>}
          renderItem={({ item, index }) => (
            <SessionRow
              session={item}
              position={listPosition(index, rows.length)}
              exiting={exitingIds.has(item.id)}
              onExited={finishExit}
              onRevoke={setPendingRevoke}
              revoking={revoke.isPending && revoke.variables === item.id}
            />
          )}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <EmptyState
                icon="phone-portrait-outline"
                title="No active sessions"
                message="No other devices are signed in."
              />
            </View>
          }
        />
      )}

      <ConfirmDialog
        visible={!!pendingRevoke}
        onDismiss={() => {
          if (revoke.isPending) return;
          setPendingRevoke(null);
        }}
        icon="log-out-outline"
        title="Revoke this session?"
        message={
          pendingRevoke
            ? `${deviceLabel(pendingRevoke)} will be signed out.`
            : ""
        }
        confirmLabel="Revoke"
        loading={revoke.isPending}
        dismissible={!revoke.isPending}
        onConfirm={() => {
          if (pendingRevoke) onRevoke(pendingRevoke);
        }}
      />
    </SettingsPage>
  );
}

/** A session row that stays painted while a revoke collapses it away. The
 * measured height springs shut (never a scaled snapshot), and a rolled-back
 * revoke reverses the exit in place. Reduced motion drops rows at once. */
function SessionRow({ session, position, exiting, onExited, onRevoke, revoking }: {
  session: SessionDto;
  position: ListPosition;
  exiting: boolean;
  onExited: (id: string) => void;
  onRevoke: (session: SessionDto) => void;
  revoking: boolean;
}) {
  const { palette, expressive } = useTheme();
  const motion = useMaterialMotion();
  const [height, setHeight] = useState<number | null>(null);
  const finishExit = useCallback(() => onExited(session.id), [onExited, session.id]);
  const size = useSurfaceSize(exiting ? 0 : height, { onSettled: exiting ? finishExit : undefined });
  const opacity = useSharedValue(1);
  const ref = React.useRef<View>(null);
  React.useLayoutEffect(() => {
    if (Platform.OS === "web" && ref.current) (ref.current as unknown as HTMLElement).inert = exiting;
  }, [exiting]);
  React.useEffect(() => {
    opacity.value = motion.reducedMotion ? Number(!exiting)
      : withSpring(Number(!exiting), { ...materialMotion.effects.fast, overshootClamping: true });
    if (!exiting) return;
    const fallback = setTimeout(finishExit, 800);
    return () => clearTimeout(fallback);
  }, [exiting, motion.reducedMotion, opacity, finishExit]);
  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      ref={ref}
      pointerEvents={exiting ? "none" : "auto"}
      aria-hidden={exiting}
      accessibilityElementsHidden={exiting}
      importantForAccessibility={exiting ? "no-hide-descendants" : "auto"}
      style={[{ overflow: "hidden", flexShrink: 0 }, size, fade]}
    >
      <View
        collapsable={false}
        onLayout={(event) => {
          const next = event.nativeEvent.layout.height;
          setHeight((current) => (current != null && Math.abs(current - next) < 0.5 ? current : next));
        }}
        style={[styles.row, { flexShrink: 0, borderBottomColor: palette.outlineVariant, borderBottomWidth: expressive ? 0 : StyleSheet.hairlineWidth,
          ...(expressive ? listCorners(position, false) : { borderRadius: 0 }),
          marginBottom: expressive && position !== "last" && position !== "only" ? spacing[2] : 0,
          backgroundColor: expressive ? palette.surfaceContainerLow : "transparent" }]}
      >
        <RowIconWell>
          <Ionicons name={deviceIcon(session)} size={ROW_ICON_GLYPH} color={palette.onSecondaryContainer} />
        </RowIconWell>
        <View style={styles.body}>
          <View style={styles.titleRow}>
            <Text variant="headline" numberOfLines={1} style={styles.title}>
              {deviceLabel(session)}
            </Text>
            {session.current ? <Badge tone="accent">This device</Badge> : null}
          </View>
          <Text variant="bodySmall" color="secondary" numberOfLines={2} style={styles.meta}>
            Active {timeAgo(session.lastSeenAt)}
            {session.ip ? ` · ${session.ip}` : ""}
          </Text>
        </View>
        {session.current ? null : (
          <Button label="Revoke" variant="danger" size="sm"
            loading={revoking}
            onPress={() => onRevoke(session)} />
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  list: { width: "100%", maxWidth: layout.maxSettingsWidth, alignSelf: "center" },
  // Matches SettingsPage so loading, error, and loaded states do not jump.
  listContent: { paddingBottom: spacing[40] },
  listContentEmpty: { flexGrow: 1, justifyContent: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[12],
    paddingHorizontal: layout.rowInset,
    paddingVertical: spacing[12],
    minHeight: 72,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  body: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing[8] },
  title: { flexShrink: 1 },
  meta: { marginTop: spacing[2] },
  emptyState: { width: "100%", maxWidth: layout.maxSettingsWidth },
});
