/**
 * Active sessions / devices list with per-session revoke (optimistic).
 */
import React, { useState } from "react";
import { ActivityIndicator, StyleSheet, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  SettingsContent,
  SettingsPage,
  SettingsSectionLabel,
} from "../../../src/components/settings/SettingsPage";
import { Text } from "../../../src/components/ui/Text";
import { Badge } from "../../../src/components/ui/Badge";
import { Button } from "../../../src/components/ui/Button";
import { Skeleton } from "../../../src/components/ui/Skeleton";
import { EmptyState } from "../../../src/components/ui/EmptyState";
import { PressableScale } from "../../../src/components/ui/PressableScale";
import { ConfirmDialog } from "../../../src/components/ui/ConfirmDialog";
import { ThemedFlatList } from "../../../src/components/ui/ThemedScrollView";
import { useSessions } from "../../../src/hooks/queries";
import { useRevokeSession } from "../../../src/hooks/use-auth-actions";
import { useTheme } from "../../../src/theme/ThemeProvider";
import { timeAgo } from "../../../src/lib/format";
import { errorMessage } from "../../../src/lib/error-message";
import { haptics } from "../../../src/lib/haptics";
import { toast } from "../../../src/components/ui/toast-store";
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
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
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
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} height={72} radiusKey="lg" style={styles.skeleton} />
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
              paddingLeft: width > layout.maxSettingsWidth + spacing[32] ? 0 : insets.left + spacing[16],
              paddingRight: width > layout.maxSettingsWidth + spacing[32] ? 0 : insets.right + spacing[16],
            },
            !(sessions?.length ?? 0) && styles.listContentEmpty,
          ]}
          ItemSeparatorComponent={() => <View style={{ height: spacing[10] }} />}
          ListHeaderComponent={<SettingsSectionLabel compact>Signed-in devices</SettingsSectionLabel>}
          renderItem={({ item }) => (
            <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <View style={styles.cardHead}>
                <View style={[styles.iconWrap, { backgroundColor: palette.surfaceSecondary }]}>
                  <Ionicons name={deviceIcon(item)} size={18} color={palette.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.titleRow}>
                    <Text variant="bodyStrong" numberOfLines={1}>{deviceLabel(item)}</Text>
                    {item.current ? <Badge tone="accent">This device</Badge> : null}
                  </View>
                  {deviceDescription(item) ? (
                    <Text variant="footnote" color="tertiary" numberOfLines={1}>
                      {deviceDescription(item)}
                    </Text>
                  ) : null}
                  <Text variant="footnote" color="tertiary" numberOfLines={1}>
                    Active {timeAgo(item.lastSeenAt)}
                    {item.ip ? ` · ${item.ip}` : ""}
                  </Text>
                </View>
              </View>
              {item.current ? null : (
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={`Revoke session on ${deviceLabel(item)}`}
                  style={[styles.revokeBtn, { borderColor: palette.danger }]}
                  onPress={() => setPendingRevoke(item)}
                >
                  {revoke.isPending && revoke.variables === item.id ? (
                    <ActivityIndicator size="small" color={palette.danger} />
                  ) : (
                    <Text variant="subhead" style={{ color: palette.danger }}>Revoke</Text>
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
  skeleton: { width: "100%", marginBottom: spacing[10] },
  list: { width: "100%", maxWidth: layout.maxSettingsWidth, alignSelf: "center" },
  // Matches SettingsPage so loading, error, and loaded states do not jump.
  listContent: { paddingTop: spacing[8], paddingBottom: spacing[40] },
  listContentEmpty: { flexGrow: 1, justifyContent: "center" },
  card: { width: "100%", borderWidth: StyleSheet.hairlineWidth, borderRadius: radius["2xl"], padding: spacing[14] },
  cardHead: { flexDirection: "row", gap: spacing[12], alignItems: "center" },
  iconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing[8], marginBottom: 2 },
  revokeBtn: { alignSelf: "flex-start", marginTop: spacing[12], paddingHorizontal: spacing[14], paddingVertical: spacing[8], borderRadius: 10, borderWidth: 1 },
  emptyState: { width: "100%", maxWidth: layout.maxSettingsWidth },
});
