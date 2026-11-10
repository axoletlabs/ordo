import React, { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import ReanimatedSwipeable, { type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import { useQueryClient } from "@tanstack/react-query";
import type { BookmarkDto, FolderDto } from "@ordo/shared";
import { useDeleteBookmark, useToggleRead } from "../../hooks/use-bookmarks";
import { useFolderTokenStore } from "../../store/folder-tokens";
import { qk } from "../../lib/api/query-keys";
import { errorMessage } from "../../lib/error-message";
import { haptics } from "../../lib/haptics";
import { useTheme } from "../../theme/ThemeProvider";
import { useMaterialMotion } from "../../theme/material-motion";
import { ListPressable } from "../ui/ListPressable";
import { Text } from "../ui/Text";
import { toast } from "../ui/toast-store";

/** Reveal actions only: releasing a swipe never deletes a bookmark. */
export function BookmarkSwipe({ bookmark, disabled, children }: {
  bookmark: BookmarkDto; disabled: boolean; children: React.ReactNode;
}) {
  const ref = useRef<SwipeableMethods>(null);
  const { palette, expressive } = useTheme();
  const motion = useMaterialMotion();
  const [revealed, setRevealed] = useState(false);
  const qc = useQueryClient();
  const read = useToggleRead(bookmark.folderId);
  const remove = useDeleteBookmark(bookmark.folderId);
  useEffect(() => { ref.current?.reset(); setRevealed(false); }, [bookmark.id, disabled]);
  const act = (action: () => void) => {
    ref.current?.close();
    if (disabled) return;
    const id = bookmark.folderId;
    if (id && qc.getQueryData<FolderDto[]>(qk.folders)?.some(f => f.id === id && f.protected)
      && !useFolderTokenStore.getState().get(id)) {
      toast.error("Unlock this folder first.");
      return;
    }
    action();
  };
  const actions = () => <View accessibilityElementsHidden={!revealed} importantForAccessibility={revealed ? "auto" : "no-hide-descendants"} aria-hidden={!revealed} pointerEvents={revealed ? "auto" : "none"} style={{ flexDirection: "row", alignItems: "stretch" }}>
    <ListPressable accessibilityRole="button" accessibilityLabel={bookmark.isRead ? "Mark unread" : "Mark read"}
      onPress={() => act(() => {
        haptics.selection();
        read.mutate({ id: bookmark.id, isRead: !bookmark.isRead }, { onError: e => toast.error(errorMessage(e)) });
      })}
      style={{ minWidth: 80, minHeight: 48, padding: 12, justifyContent: "center", backgroundColor: palette.secondaryContainer }}>
      <Text variant="labelLarge" style={{ color: palette.onSecondaryContainer }}>{bookmark.isRead ? "Unread" : "Read"}</Text>
    </ListPressable>
    <ListPressable accessibilityRole="button" accessibilityLabel="Delete bookmark"
      onPress={() => act(() => { haptics.medium(); remove.mutate(bookmark); })}
      style={{ minWidth: 80, minHeight: 48, padding: 12, justifyContent: "center", backgroundColor: palette.errorContainer }}>
      <Text variant="labelLarge" style={{ color: palette.onErrorContainer }}>Delete</Text>
    </ListPressable>
  </View>;
  return <ReanimatedSwipeable ref={ref} enabled={!disabled} friction={1}
    dragOffsetFromLeftEdge={20} dragOffsetFromRightEdge={20} rightThreshold={64}
    overshootRight={false} renderRightActions={actions}
    onSwipeableWillOpen={() => setRevealed(true)} onSwipeableWillClose={() => setRevealed(false)}
    animationOptions={{ ...motion.spatial, ...(motion.reducedMotion ? { overshootClamping: true, damping: 1000 } : {}) }}
    containerStyle={{ marginBottom: expressive ? 2 : 0 }}
    childrenContainerStyle={{ backgroundColor: expressive ? palette.surfaceContainerLow : palette.surface }}>
    {children}
  </ReanimatedSwipeable>;
}
