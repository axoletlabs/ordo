/**
 * Active sessions / devices list with per-session revoke (optimistic).
 */
import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { MaterialIcon as Ionicons } from "../../../src/components/ui/MaterialIcon";
import { useColumnPadding } from "../../../src/hooks/use-scene-column-insets";
import {
  SettingsContent,
  SettingsPage,
  SettingsSectionLabel,
} from "../../../src/components/settings/SettingsPage";
import { Text } from "../../../src/components/ui/Text";
import { Spinner } from "../../../src/components/ui/Spinner";
import { Badge } from "../../../src/components/ui/Badge";
import { Button } from "../../../src/components/ui/Button";
import { Skeleton } from "../../../src/components/ui/Skeleton";
import { EmptyState } from "../../../src/components/ui/EmptyState";
import { PressableScale } from "../../../src/components/ui/PressableScale";
import { RowIconWell } from "../../../src/components/ui/RowIconWell";
import { ConfirmDialog } from "../../../src/components/ui/ConfirmDialog";
import { ThemedFlatList } from "../../../src/components/ui/ThemedScrollView";
import { useSessions } from "../../../src/hooks/queries";
import { useRevokeSession } from "../../../src/hooks/use-auth-actions";
import { useTheme } from "../../../src/theme/ThemeProvider";
import { timeAgo } from "../../../src/lib/format";
import { errorMessage } from "../../../src/lib/error-message";
import { haptics } from "../../../src/lib/haptics";
import { toast } from "../../../src/components/ui/toast-store";
import { ROW_ICON_FRAME, ROW_ICON_GLYPH } from "../../../src/theme/alignment";
import { layout, radius, spacing } from "../../../src/theme/tokens";
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

function deviceDescription(s: SessionDto): string {
  const ua = s.deviceInfo ?? "";
  const os = /android/i.test(ua)
    ? "Android"
    : /iphone|ipad|ios/i.test(ua)
      ? "iOS"
      : /windows/i.test(ua)
        ? "Windows"
        : /mac/i.test(ua)
          ? "macOS"
          : /linux/i.test(ua)
            ? "Linux"
            : null;
  const type = s.deviceType === "unknown"
    ? null
    : `${s.deviceType[0].toUpperCase()}${s.deviceType.slice(1)}`;
  return [os, type].filter(Boolean).join(" · ");
}

function deviceIcon(s: SessionDto): keyof typeof Ionicons.glyphMap {
  if (s.deviceType === "phone") return "phone-portrait-outline";
  if (s.deviceType === "tablet") return "tablet-portrait-outline";
  if (s.deviceType === "desktop") return "desktop-outline";
  if (s.deviceType === "tv") return "tv-outline";
  return "hardware-chip-outline";
}

export default function SessionsScreen() {
  const { palette, expressive } = useTheme();
  const column = useColumnPadding(layout.maxSettingsWidth);
  const { data: sessions, isLoading, error, refetch } = useSessions();
  const revoke = useRevokeSession();
  const [pendingRevoke, setPendingRevoke] = useState<SessionDto | null>(null);

  const onRevoke = (session: SessionDto) => {
    haptics.medium();
    revoke.mutate(session.id, {
      onSuccess: () => toast.success("Session revoked"),
      onError: (e) => toast.error(errorMessage(e)),
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
          {Array.from({ length: 3 }).map((_, i) => (
            <View key={i} style={[styles.row, { borderBottomColor: palette.border }]}>
              <Skeleton width={ROW_ICON_FRAME} height={ROW_ICON_FRAME} radiusKey="sm" />
              <View style={styles.skeletonCopy}>
                <Skeleton width="56%" height={15} />
                <Skeleton width="36%" height={11} />
              </View>
            </View>
          ))}
        </SettingsContent>
      ) : (
        <ThemedFlatList
          data={sessions ?? []}
          keyExtractor={(s) => s.id}
          style={styles.list}
          contentContainerStyle={[
            styles.listContent,
            {
              paddingLeft: column.left,
              paddingRight: column.right,
            },
            !(sessions?.length ?? 0) && styles.listContentEmpty,
          ]}
          ListHeaderComponent={<SettingsSectionLabel compact>Signed-in devices</SettingsSectionLabel>}
          renderItem={({ item }) => (
            <View style={[styles.row, { borderBottomColor: palette.outlineVariant, borderBottomWidth: expressive ? 0 : StyleSheet.hairlineWidth,
              borderRadius: expressive ? radius.xl : 0, marginBottom: expressive ? spacing[4] : 0,
              backgroundColor: expressive ? palette.surfaceContainerLow : "transparent" }]}>
              <RowIconWell>
                <Ionicons name={deviceIcon(item)} size={ROW_ICON_GLYPH} color={palette.onSecondaryContainer} />
              </RowIconWell>
              <View style={styles.body}>
                <View style={styles.titleRow}>
                  <Text variant="headline" numberOfLines={1} style={styles.title}>
                    {deviceLabel(item)}
                  </Text>
                  {item.current ? <Badge tone="accent">This device</Badge> : null}
                </View>
                {deviceDescription(item) ? (
                  <Text variant="footnote" color="tertiary" numberOfLines={1} style={styles.meta}>
                    {deviceDescription(item)}
                  </Text>
                ) : null}
                <Text variant="monoSmall" color="tertiary" numberOfLines={1} style={styles.meta}>
                  Active {timeAgo(item.lastSeenAt)}
                  {item.ip ? ` · ${item.ip}` : ""}
                </Text>
              </View>
              {item.current ? null : (
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={`Revoke session on ${deviceLabel(item)}`}
                  style={styles.revoke}
                  onPress={() => setPendingRevoke(item)}
                >
                  {revoke.isPending && revoke.variables === item.id ? (
                    <Spinner size="sm" color={palette.danger} />
                  ) : (
                    <Text variant="label" color="danger">Revoke</Text>
                  )}
                </PressableScale>
              )}
            </View>
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
  skeletonCopy: { flex: 1, minWidth: 0, gap: spacing[6] },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing[8] },
  title: { flexShrink: 1 },
  meta: { marginTop: spacing[2] },
  revoke: { flexShrink: 0, minHeight: 48, justifyContent: "center", paddingHorizontal: spacing[12], borderRadius: radius.full },
  emptyState: { width: "100%", maxWidth: layout.maxSettingsWidth },
});
