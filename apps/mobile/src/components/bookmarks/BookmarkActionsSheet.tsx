import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { FloatingPanel } from "../ui/FloatingPanel";
import { PanelHeader } from "../ui/PanelHeader";
import { Button } from "../ui/Button";
import { ContextMenu, ContextMenuItem, type MenuAnchor } from "../ui/ContextMenu";
import { sheetMenuStyles } from "../ui/SheetActionRow";
import { copyLink } from "../../lib/copy-link";
import { openLivePage } from "../../lib/open-website";
import { useSettingsStore } from "../../store/settings";
import { useTheme } from "../../theme/ThemeProvider";
import { bookmarkCanBeArticle, bookmarkIsArticle } from "../../lib/bookmark-reader";
import * as bookmarkHooks from "../../hooks/use-bookmarks";
import { toast } from "../ui/toast-store";
import { errorMessage } from "../../lib/error-message";
import type { BookmarkDto } from "@ordo/shared";

function useSetContentKindMissing() {
  return { mutate: () => undefined, isPending: false };
}

const useSetContentKind =
  typeof bookmarkHooks.useSetContentKind === "function"
    ? bookmarkHooks.useSetContentKind
    : useSetContentKindMissing;

export interface BookmarkActionsSheetProps {
  visible: boolean;
  onDismiss: () => void;
  bookmark: BookmarkDto | null;
  anchor?: MenuAnchor | null;
  onToggleRead: (bookmark: BookmarkDto) => void;
  onMove: (bookmark: BookmarkDto) => void;
  onDelete: (bookmark: BookmarkDto) => void;
  onEditTags?: (bookmark: BookmarkDto) => void;
}

export function BookmarkActionsSheet({
  visible,
  onDismiss,
  bookmark,
  anchor,
  onToggleRead,
  onMove,
  onDelete,
  onEditTags,
}: BookmarkActionsSheetProps) {
  const router = useRouter();
  const { palette } = useTheme();
  const setContentKind = useSetContentKind();
  const [mode, setMode] = useState<"menu" | "delete">("menu");

  useEffect(() => {
    if (visible) setMode("menu");
  }, [visible]);

  if (!bookmark) return null;

  return (
    <>
      <ContextMenu visible={visible && mode === "menu"} onDismiss={onDismiss} anchor={anchor}>
        <ContextMenuItem
          icon={bookmark.isRead ? "radio-button-off" : "checkmark-circle"}
          label={bookmark.isRead ? "Mark as unread" : "Mark as read"}
          onPress={() => {
            onToggleRead(bookmark);
            onDismiss();
          }}
        />
        <ContextMenuItem
          icon="folder-open-outline"
          label="Move to folder"
          onPress={() => {
            onMove(bookmark);
            onDismiss();
          }}
        />
        {onEditTags ? (
          <ContextMenuItem
            icon="pricetags-outline"
            label="Edit tags"
            onPress={() => {
              onEditTags(bookmark);
              onDismiss();
            }}
          />
        ) : null}
        <ContextMenuItem
          icon="globe-outline"
          label="Open original"
          onPress={() => {
            const browser = useSettingsStore.getState().websiteBrowser;
            if (browser === "ordo") {
              router.push({
                pathname: "/reader/[id]",
                params: { id: bookmark.id, view: "browser" },
              });
            } else {
              void openLivePage(bookmark.url, browser);
            }
            if (!bookmark.isRead) onToggleRead(bookmark);
            onDismiss();
          }}
        />
        {typeof bookmarkHooks.useSetContentKind === "function" && bookmarkIsArticle(bookmark) ? (
          <ContextMenuItem
            icon="globe-outline"
            label="Mark as website"
            onPress={() => {
              setContentKind.mutate(
                {
                  id: bookmark.id,
                  folderId: bookmark.folderId,
                  contentKindOverride: "web",
                },
                {
                  onSuccess: () => toast.success("Saved as a website"),
                  onError: (err) => toast.error(errorMessage(err, "Couldn't update this bookmark.")),
                },
              );
              onDismiss();
            }}
          />
        ) : typeof bookmarkHooks.useSetContentKind === "function" && bookmarkCanBeArticle(bookmark) ? (
          <ContextMenuItem
            icon="reader-outline"
            label="Mark as article"
            onPress={() => {
              setContentKind.mutate(
                {
                  id: bookmark.id,
                  folderId: bookmark.folderId,
                  contentKindOverride: "article",
                },
                {
                  onSuccess: () => toast.success("Saved as an article"),
                  onError: (err) => toast.error(errorMessage(err, "Couldn't update this bookmark.")),
                },
              );
              onDismiss();
            }}
          />
        ) : null}
        <ContextMenuItem
          icon="link-outline"
          label="Copy link"
          onPress={() => {
            void copyLink(bookmark.url);
            onDismiss();
          }}
        />
        <ContextMenuItem
          icon="trash-outline"
          label="Delete bookmark"
          tone="danger"
          onPress={() => setMode("delete")}
        />
      </ContextMenu>

      <FloatingPanel visible={visible && mode === "delete"} onDismiss={onDismiss} fitContent>
        <PanelHeader
          icon="trash-outline"
          iconColor={palette.danger}
          iconBackground={palette.dangerSoft}
          title="Delete this bookmark?"
          subtitle="You can undo this."
        />
        <View style={sheetMenuStyles.stack}>
          <Button
            label="Delete bookmark"
            variant="danger"
            block
            size="lg"
            onPress={() => {
              onDelete(bookmark);
              onDismiss();
            }}
          />
          <Button label="Cancel" variant="ghost" block onPress={() => setMode("menu")} />
        </View>
      </FloatingPanel>
    </>
  );
}
