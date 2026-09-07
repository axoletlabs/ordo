/**
 * Tag management: browse every tag, create new ones, rename/recolor, and
 * delete (with confirmation showing the affected assignment count).
 */
import React, { useMemo, useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Header } from "../../../src/components/ui/Header";
import { FAB, FABLayer } from "../../../src/components/ui/FAB";
import { ScreenContent } from "../../../src/components/ui/ScreenContent";
import { EmptyState } from "../../../src/components/ui/EmptyState";
import { Skeleton } from "../../../src/components/ui/Skeleton";
import { Button } from "../../../src/components/ui/Button";
import { Text } from "../../../src/components/ui/Text";
import { PressableScale } from "../../../src/components/ui/PressableScale";
import { ConfirmDialog } from "../../../src/components/ui/ConfirmDialog";
import { CreateTagPanel } from "../../../src/components/tags/CreateTagPanel";
import { EditTagPanel } from "../../../src/components/tags/EditTagPanel";
import { useDeleteTag, useTags } from "../../../src/hooks/use-tags";
import { tagColorValue } from "../../../src/lib/tag-colors";
import { haptics } from "../../../src/lib/haptics";
import { errorMessage } from "../../../src/lib/error-message";
import { useTheme } from "../../../src/theme/ThemeProvider";
import { layout, radius, spacing } from "../../../src/theme/tokens";
import type { TagDto } from "@ordo/shared";

export default function TagsScreen() {
  const { palette } = useTheme();
  const router = useRouter();
  const { data: tags, isLoading, error, refetch } = useTags();
  const deleteTag = useDeleteTag();

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<TagDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TagDto | null>(null);

  const sorted = useMemo(
    () =>
      [...(tags ?? [])].sort(
        (a, b) => b.bookmarkCount - a.bookmarkCount || a.name.localeCompare(b.name),
      ),
    [tags],
  );

  const onDelete = () => {
    const target = deleteTarget;
    if (!target) return;
    haptics.medium();
    setDeleteTarget(null);
    deleteTag.mutate(target);
  };

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <Header
        title="Tags"
        showBack
        maxWidth={layout.maxContentWidth}
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/"))}
      />

      <ScreenContent maxWidth={layout.maxContentWidth} style={styles.content}>
        {isLoading ? (
          <View style={styles.skeletons}>
            <Skeleton height={52} radiusKey="lg" />
            <Skeleton height={52} radiusKey="lg" />
            <Skeleton height={52} radiusKey="lg" />
          </View>
        ) : error && !tags ? (
          <View style={styles.center}>
            <EmptyState
              icon="cloud-offline-outline"
              title="Couldn't load tags"
              message={errorMessage(error)}
              action={<Button label="Retry" onPress={() => refetch()} />}
            />
          </View>
        ) : sorted.length === 0 ? (
          <View style={styles.center}>
            <EmptyState
              icon="pricetags-outline"
              title="No tags yet"
              message="Create a tag to organize bookmarks."
              action={<Button label="New tag" onPress={() => setCreateOpen(true)} />}
            />
          </View>
        ) : (
          <FlatList
            data={sorted}
            keyExtractor={(t) => t.id}
            renderItem={({ item }) => (
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={`${item.name}, ${item.bookmarkCount} bookmarks`}
                style={[styles.row, { borderBottomColor: palette.border }]}
                onPress={() => router.push(`/tags/${item.id}`)}
              >
                <View style={[styles.dot, { backgroundColor: tagColorValue(item.color).dot }]} />
                <View style={styles.rowCopy}>
                  <Text variant="body" numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text variant="caption" color="tertiary">
                    {item.bookmarkCount} {item.bookmarkCount === 1 ? "bookmark" : "bookmarks"}
                  </Text>
                </View>
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={`Edit tag ${item.name}`}
                  style={styles.rowAction}
                  scaleTo={0.85}
                  hitSlop={8}
                  onPress={() => setEditTarget(item)}
                >
                  <Ionicons name="create-outline" size={20} color={palette.textTertiary} />
                </PressableScale>
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={`Delete tag ${item.name}`}
                  style={styles.rowAction}
                  scaleTo={0.85}
                  hitSlop={8}
                  onPress={() => setDeleteTarget(item)}
                >
                  <Ionicons name="trash-outline" size={20} color={palette.danger} />
                </PressableScale>
              </PressableScale>
            )}
            contentContainerStyle={{ paddingBottom: spacing[96] }}
          />
        )}
      </ScreenContent>

      {sorted.length > 0 ? (
        <FABLayer maxWidth={layout.maxContentWidth}>
          <FAB
            onPress={() => setCreateOpen(true)}
            accessibilityLabel="New tag"
            right={spacing[20]}
          />
        </FABLayer>
      ) : null}

      <CreateTagPanel visible={createOpen} onDismiss={() => setCreateOpen(false)} />
      <EditTagPanel
        visible={!!editTarget}
        tag={editTarget}
        onDismiss={() => setEditTarget(null)}
      />
      <ConfirmDialog
        visible={!!deleteTarget}
        icon="trash-outline"
        onDismiss={() => setDeleteTarget(null)}
        title={
          deleteTarget
            ? deleteTarget.bookmarkCount > 0
              ? `Delete "${deleteTarget.name}" from ${deleteTarget.bookmarkCount} bookmarks?`
              : `Delete "${deleteTarget.name}"?`
            : ""
        }
        message="The tag is removed. Bookmarks are kept. You can undo this."
        confirmLabel="Delete tag"
        onConfirm={onDelete}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, width: "100%" },
  center: { flex: 1, width: "100%", justifyContent: "center" },
  skeletons: { gap: spacing[10], paddingTop: spacing[8] },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[12],
    paddingVertical: spacing[12],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dot: { width: 12, height: 12, borderRadius: 9999 },
  rowCopy: { flex: 1, minWidth: 0 },
  rowAction: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
  },
});
