/**
 * Last-three server recents on the Server settings page.
 * Tapping one opens the change-server sheet with that address filled in.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SettingsGroup } from "./SettingsPage";
import { PressableScale } from "../ui/PressableScale";
import { Text } from "../ui/Text";
import { timeAgo } from "../../lib/format";
import { hostOf } from "../../lib/server-probe";
import type { ServerHistoryEntry } from "../../lib/server-history";
import { useTheme } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";

export function ServerHistoryPanel({
  entries,
  busy,
  onSelect,
  onRemove,
}: {
  entries: ServerHistoryEntry[];
  busy: boolean;
  onSelect: (url: string) => void;
  onRemove: (url: string) => void;
}) {
  const { palette } = useTheme();
  if (entries.length === 0) return null;

  return (
    <SettingsGroup label="Recent servers">
      {entries.map((entry, index) => {
        const host = hostOf(entry.url);

        return (
          <View
            key={entry.url}
            style={[
              styles.row,
              { borderBottomColor: palette.border },
              index === entries.length - 1 && styles.noDivider,
            ]}
          >
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={`Change to recent server ${host}`}
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              dim
              onPress={() => onSelect(entry.url)}
              style={styles.select}
            >
              <View style={[styles.iconWrap, { backgroundColor: palette.surfaceSecondary }]}>
                <Ionicons name="time-outline" size={16} color={palette.textTertiary} />
              </View>
              <View style={styles.body}>
                <Text variant="bodyStrong" numberOfLines={1}>
                  {host}
                </Text>
                <Text variant="footnote" color="tertiary" numberOfLines={1}>
                  Last used {timeAgo(new Date(entry.lastConnectedAt).toISOString())}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={palette.textFaint} />
            </PressableScale>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={`Remove ${host} from history`}
              accessibilityState={{ disabled: busy }}
              hitSlop={8}
              disabled={busy}
              onPress={() => onRemove(entry.url)}
              style={[styles.remove, { opacity: busy ? 0.4 : 1 }]}
            >
              <Ionicons name="close" size={18} color={palette.textTertiary} />
            </PressableScale>
          </View>
        );
      })}
    </SettingsGroup>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  noDivider: { borderBottomWidth: 0 },
  select: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[12],
    minHeight: 52,
    paddingLeft: spacing[16],
    paddingVertical: spacing[10],
    borderRadius: radius.sm,
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { flex: 1, minWidth: 0, gap: spacing[2] },
  remove: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing[4],
  },
});
