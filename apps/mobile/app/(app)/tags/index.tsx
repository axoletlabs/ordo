/**
 * Tag catalogue: browse every tag, create new ones, and edit or delete
 * from the same long-press menu used on folders and bookmarks.
 */
import React, { useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Header } from "../../../src/components/ui/Header";
import { FAB, FABLayer } from "../../../src/components/ui/FAB";
import { ScreenContent } from "../../../src/components/ui/ScreenContent";
import { ThemedFlashList } from "../../../src/components/ui/ThemedScrollView";
import { EmptyState } from "../../../src/components/ui/EmptyState";
import { Skeleton } from "../../../src/components/ui/Skeleton";
import { Button } from "../../../src/components/ui/Button";
import { CreateTagPanel } from "../../../src/components/tags/CreateTagPanel";
import { TagRow, TAG_ROW_SIZE } from "../../../src/components/tags/TagRow";
import { TagActionsSheet } from "../../../src/components/tags/TagActionsSheet";
import { useTags } from "../../../src/hooks/use-tags";
import { errorMessage } from "../../../src/lib/error-message";
import { useTheme } from "../../../src/theme/ThemeProvider";
import { layout, spacing } from "../../../src/theme/tokens";
import type { TagDto } from "@ordo/shared";
import type { MenuAnchorRect } from "../../../src/lib/menu-anchor";

export default function TagsScreen() {
  const { palette } = useTheme();
  const router = useRouter();
  const { data: tags, isLoading, isFetching, error, refetch } = useTags();

  const [createOpen, setCreateOpen] = useState(false);
  const [actionsTag, setActionsTag] = useState<TagDto | null>(null);
  const [actionsAnchor, setActionsAnchor] = useState<MenuAnchorRect | null>(null);

  const items = tags ?? [];

  const onPressTag = useCallback(
    (tag: TagDto) => {
      router.push(`/tags/${tag.id}`);
    },
    [router],
  );

  const onMoreTag = useCallback((tag: TagDto, anchor: MenuAnchorRect) => {
    setActionsAnchor(anchor);
    setActionsTag(tag);
  }, []);

  const renderTag = useCallback(
    ({ item }: { item: TagDto }) => (
      <TagRow
        tag={item}
        highlighted={actionsTag?.id === item.id}
        onPress={onPressTag}
        onMore={onMoreTag}
      />
    ),
    [actionsTag?.id, onMoreTag, onPressTag],
  );

  const listContentStyle = useMemo(
    () => ({ paddingBottom: spacing[96] }),
    [],
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <Header
        title="Tags"
        subtitle={
          items.length > 0
            ? `${items.length} ${items.length === 1 ? "tag" : "tags"}`
            : undefined
        }
        showBack
        maxWidth={layout.maxContentWidth}
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/"))}
      />

      <ScreenContent maxWidth={layout.maxContentWidth} style={styles.content}>
        {isLoading ? (
          <TagListSkeleton />
        ) : error && !tags ? (
          <View style={styles.center}>
            <EmptyState
              icon="cloud-offline-outline"
              title="Couldn't load tags"
              message={errorMessage(error)}
              action={<Button label="Retry" onPress={() => refetch()} />}
            />
          </View>
        ) : items.length === 0 ? (
          <View style={styles.center}>
            <EmptyState
              icon="pricetags-outline"
              title="No tags yet"
              message="Create a tag to organize bookmarks."
              action={<Button label="New tag" onPress={() => setCreateOpen(true)} />}
            />
          </View>
        ) : (
          <ThemedFlashList
            data={items}
            extraData={actionsTag?.id ?? ""}
            keyExtractor={(tag: TagDto) => tag.id}
            renderItem={renderTag}
            estimatedItemSize={TAG_ROW_SIZE}
            overrideItemLayout={(layout) => {
              layout.size = TAG_ROW_SIZE;
            }}
            contentContainerStyle={listContentStyle}
            refreshing={isFetching && !isLoading}
            onRefresh={() => refetch()}
          />
        )}
      </ScreenContent>

      {items.length > 0 ? (
        <FABLayer maxWidth={layout.maxContentWidth}>
          <FAB
            onPress={() => setCreateOpen(true)}
            accessibilityLabel="New tag"
            right={spacing[20]}
          />
        </FABLayer>
      ) : null}

      <CreateTagPanel visible={createOpen} onDismiss={() => setCreateOpen(false)} />
      <TagActionsSheet
        visible={!!actionsTag}
        tag={actionsTag}
        anchor={actionsAnchor}
        onDismiss={() => {
          setActionsTag(null);
          setActionsAnchor(null);
        }}
      />
    </View>
  );
}

function TagListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <View>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={styles.skeletonRow}>
          <Skeleton width={36} height={36} radiusKey="sm" />
          <View style={styles.skeletonCopy}>
            <Skeleton width="42%" height={15} />
            <Skeleton width="28%" height={11} style={{ marginTop: spacing[8] }} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, width: "100%" },
  center: { flex: 1, width: "100%", justifyContent: "center" },
  skeletonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[12],
    paddingVertical: spacing[12],
    paddingHorizontal: spacing[16],
  },
  skeletonCopy: { flex: 1, minWidth: 0 },
});
