import React, { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { ContextMenu, ContextMenuItem } from "../ui/ContextMenu";
import { copyLink } from "../../lib/copy-link";
import { openLivePage } from "../../lib/open-website";
import { useSettingsStore } from "../../store/settings";
import { bookmarkCanBeArticle, bookmarkIsArticle } from "../../lib/bookmark-reader";
import * as bookmarkHooks from "../../hooks/use-bookmarks";
import { toast } from "../ui/toast-store";
import { errorMessage } from "../../lib/error-message";
import { bookmarkKey } from "../../hooks/use-selection";
import { useMenuHighlightStore } from "../../hooks/use-menu-highlight";
import type { MenuAnchorRect } from "../../lib/menu-anchor";
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
  anchor: MenuAnchorRect | null;
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
  const setContentKind = useSetContentKind();
  const [mode, setMode] = useState<"menu" | "delete">("menu");
  const bookmarkRef = React.useRef(bookmark);
  if (bookmark) bookmarkRef.current = bookmark;
  const displayBookmark = bookmark ?? bookmarkRef.current;

  useEffect(() => {
    if (visible) setMode("menu");
  }, [visible]);

  useEffect(() => {
    if (!visible || !displayBookmark) return;
    const key = bookmarkKey(displayBookmark.id);
    useMenuHighlightStore.getState().set(key);
    return () => {
      const store = useMenuHighlightStore.getState();
      if (store.key === key) store.set(null);
    };
  }, [visible, displayBookmark]);

  if (!displayBookmark) return null;

  return (
    <ContextMenu visible={visible} onDismiss={onDismiss} anchor={anchor}>
      {mode === "delete" ? (
        <>
          <ContextMenuItem
            icon="trash-outline"
            label="Confirm deletion"
            tone="danger"
            onPress={() => {
              onDelete(displayBookmark);
              onDismiss();
            }}
          />
          <ContextMenuItem icon="close-outline" label="Cancel" onPress={() => setMode("menu")} />
        </>
      ) : (
        <>
          <ContextMenuItem
            icon={displayBookmark.isRead ? "radio-button-off" : "checkmark-circle"}
            label={displayBookmark.isRead ? "Mark as unread" : "Mark as read"}
            onPress={() => {
              onToggleRead(displayBookmark);
              onDismiss();
            }}
          />
          <ContextMenuItem
            icon="folder-open-outline"
            label="Move to folder"
            onPress={() => {
              onMove(displayBookmark);
              onDismiss();
            }}
          />
          {onEditTags ? (
            <ContextMenuItem
              icon="pricetags-outline"
              label="Edit tags"
              onPress={() => {
                onEditTags(displayBookmark);
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
                  params: { id: displayBookmark.id, view: "browser" },
                });
              } else {
                void openLivePage(displayBookmark.url, browser);
              }
              if (!displayBookmark.isRead) onToggleRead(displayBookmark);
              onDismiss();
            }}
          />
          {typeof bookmarkHooks.useSetContentKind === "function" && bookmarkIsArticle(displayBookmark) ? (
            <ContextMenuItem
              icon="globe-outline"
              label="Mark as website"
              onPress={() => {
                setContentKind.mutate(
                  {
                    id: displayBookmark.id,
                    folderId: displayBookmark.folderId,
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
          ) : typeof bookmarkHooks.useSetContentKind === "function" && bookmarkCanBeArticle(displayBookmark) ? (
            <ContextMenuItem
              icon="reader-outline"
              label="Mark as article"
              onPress={() => {
                setContentKind.mutate(
                  {
                    id: displayBookmark.id,
                    folderId: displayBookmark.folderId,
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
              void copyLink(displayBookmark.url);
              onDismiss();
            }}
          />
          <ContextMenuItem
            icon="trash-outline"
            label="Delete bookmark"
            tone="danger"
            onPress={() => setMode("delete")}
          />
        </>
      )}
    </ContextMenu>
  );
}
