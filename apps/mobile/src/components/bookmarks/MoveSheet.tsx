/**
 * Floating dialog to move one or more bookmarks into another folder.
 */
import React, { useEffect, useState } from "react";
import { PinIcon } from "../ui/PinIcon";
import { FloatingPanel } from "../ui/FloatingPanel";
import { PanelHeader } from "../ui/PanelHeader";
import { UnlockForm } from "./LockPrompt";
import { FolderLockIcon } from "./FolderLockIcon";
import { Text } from "../ui/Text";
import { SheetActionRow } from "../ui/SheetActionRow";
import { ThemedFlatList } from "../ui/ThemedScrollView";
import { useFolders } from "../../hooks/queries";
import { useFolderTokenStore } from "../../store/folder-tokens";
import { errorMessage, isFolderProtected } from "../../lib/error-message";
import { haptics } from "../../lib/haptics";
import { toast } from "../ui/toast-store";
import { movedBookmarksToast } from "../../lib/copy";
import { useTheme } from "../../theme/ThemeProvider";
import { spacing } from "../../theme/tokens";
import { useResponsiveLayout } from "../../hooks/use-responsive-layout";
import { DEFAULT_FOLDER_ICON, type BookmarkDto, type FolderDto } from "@ordo/shared";
import { useMoveBookmark, useBatchBookmarks } from "../../hooks/use-bookmarks";

export interface MoveSheetProps {
  visible: boolean;
  onDismiss: () => void;
  bookmark?: BookmarkDto | null;
  bookmarks?: BookmarkDto[];
  /** Folder the list is currently scoped to, or null for unfiled root. */
  fromFolderId: string | null;
  onMoved?: () => void;
}

/** Sentinel row representing the unfiled root ("Bookmarks"). */
const ROOT_DESTINATION = Symbol("root");
type Destination = FolderDto | typeof ROOT_DESTINATION;

function isRootDestination(d: Destination): d is typeof ROOT_DESTINATION {
  return d === ROOT_DESTINATION;
}

export function MoveSheet({
  visible,
  onDismiss,
  bookmark,
  bookmarks,
  fromFolderId,
  onMoved,
}: MoveSheetProps) {
  const { palette } = useTheme();
  const { data: folders } = useFolders();
  const move = useMoveBookmark(fromFolderId);
  const batch = useBatchBookmarks();
  const { height } = useResponsiveLayout();
  const [error, setError] = useState("");
  const [lockedTarget, setLockedTarget] = useState<FolderDto | null>(null);
  const accessRevision = useFolderTokenStore((s) => s.accessRevision);
  const targets = bookmarks ?? (bookmark ? [bookmark] : []);
  const destinationUnlocked = (id: string) => {
    void accessRevision;
    return Boolean(useFolderTokenStore.getState().get(id));
  };

  useEffect(() => {
    if (visible) {
      setError("");
      setLockedTarget(null);
    }
  }, [visible]);

  // Offer the unfiled root as a destination only when currently inside a folder.
  const destinations: Destination[] = (folders ?? []).filter((f) => f.id !== fromFolderId);
  if (fromFolderId !== null) destinations.unshift(ROOT_DESTINATION);

  const pick = async (destination: Destination) => {
    if (targets.length === 0) return;
    const toFolderId = isRootDestination(destination) ? null : destination.id;
    const name = isRootDestination(destination) ? "Bookmarks" : destination.name;
    setError("");
    if (!isRootDestination(destination) && destination.protected && !useFolderTokenStore.getState().get(destination.id)) {
      setLockedTarget(destination);
      return;
    }
    haptics.light();
    try {
      if (targets.length === 1) {
        await move.mutateAsync({ id: targets[0].id, toFolderId });
      } else {
        await batch.mutateAsync({
          action: "move",
          ids: targets.map((item) => item.id),
          folderId: toFolderId,
          scopeFolderId: fromFolderId,
        });
      }
      toast.success(movedBookmarksToast(targets.length, name));
      onMoved?.();
      onDismiss();
    } catch (e) {
      if (!isRootDestination(destination) && isFolderProtected(e)) {
        setLockedTarget(destination);
        return;
      }
      setError(errorMessage(e));
    }
  };

  return (
    <FloatingPanel
      visible={visible}
      onDismiss={() => {
        if (lockedTarget) setLockedTarget(null);
        else onDismiss();
      }}
    >
      {lockedTarget ? (
        <UnlockForm
          folderId={lockedTarget.id}
          folderName={lockedTarget.name}
          lockType={lockedTarget.lockType}
          pinLength={lockedTarget.pinLength}
          autoPromptDevice
          onCancel={() => setLockedTarget(null)}
          onUnlocked={() => {
            const target = lockedTarget;
            setLockedTarget(null);
            if (target) void pick(target);
          }}
        />
      ) : (
        <>
          <PanelHeader title="Move to folder" />
          {error ? (
            <Text variant="footnote" color="danger" style={{ marginBottom: spacing[8] }}>
              {error}
            </Text>
          ) : null}
          {destinations.length === 0 ? (
            <Text variant="body" color="secondary">No other folders available.</Text>
          ) : (
            <ThemedFlatList
              data={destinations}
              keyExtractor={(d) => (isRootDestination(d) ? "root" : d.id)}
              renderItem={({ item }) => (
                <SheetActionRow
                  icon={isRootDestination(item) ? "bookmark-outline" : (item.icon ?? DEFAULT_FOLDER_ICON)}
                  label={isRootDestination(item) ? "Bookmarks" : item.name}
                  trailing={
                    isRootDestination(item) ? undefined : (
                      <>
                        {item.pinned ? <PinIcon size={14} color={palette.accent} /> : null}
                        {item.protected ? <FolderLockIcon unlocked={destinationUnlocked(item.id)} size={14} /> : null}
                        <Text variant="footnote" color="tertiary">{item.bookmarkCount}</Text>
                      </>
                    )
                  }
                  onPress={() => void pick(item)}
                />
              )}
              style={{ maxHeight: Math.min(320, height * 0.5) }}
            />
          )}
        </>
      )}
    </FloatingPanel>
  );
}
