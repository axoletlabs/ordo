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
import { ContextMenuItem } from "../ui/ContextMenu";
import { BookmarkMoveIndicator } from "./BookmarkMoveIndicator";
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
import { useMaterialMotion } from "../../theme/material-motion";
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
  const motion = useMaterialMotion();
  const [pickedId, setPickedId] = useState<string | null | undefined>(undefined);
  const [completed, setCompleted] = useState<{ count: number; name: string } | null>(null);
  const inFlight = React.useRef(false);
  const session = React.useRef(0);
  const active = React.useRef(visible);
  active.current = visible;
  const busy = move.isPending || batch.isPending || Boolean(completed);
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
    session.current += 1;
    inFlight.current = false;
    if (visible) {
      setError("");
      setLockedTarget(null);
      setPickedId(undefined);
      setCompleted(null);
    }
    return () => { session.current += 1; };
  }, [visible]);

  const finishRef = React.useRef(() => {});
  finishRef.current = () => {
    if (!completed || !active.current) return;
    toast.success(movedBookmarksToast(completed.count, completed.name));
    onMoved?.();
    onDismiss();
  };
  useEffect(() => {
    if (!visible || !completed) return;
    if (motion.reducedMotion) { finishRef.current(); return; }
    // Let the shared spatial/effects springs settle before the panel exits.
    const timer = setTimeout(() => finishRef.current(), 600);
    return () => clearTimeout(timer);
  }, [visible, completed, motion.reducedMotion]);

  // Offer the unfiled root as a destination only when currently inside a folder.
  const destinations: Destination[] = (folders ?? []).filter((f) => f.id !== fromFolderId);
  if (fromFolderId !== null) destinations.unshift(ROOT_DESTINATION);

  const pick = async (destination: Destination) => {
    if (targets.length === 0 || busy || inFlight.current) return;
    const toFolderId = isRootDestination(destination) ? null : destination.id;
    const name = isRootDestination(destination) ? "Bookmarks" : destination.name;
    setError("");
    if (!isRootDestination(destination) && destination.protected && !useFolderTokenStore.getState().get(destination.id)) {
      setLockedTarget(destination);
      return;
    }
    inFlight.current = true;
    const epoch = session.current;
    const count = targets.length;
    setPickedId(toFolderId);
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
      if (!active.current || session.current !== epoch) return;
      haptics.success();
      setCompleted({ count, name });
    } catch (e) {
      if (!active.current || session.current !== epoch) return;
      inFlight.current = false;
      setPickedId(undefined);
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
      scrollBody={Boolean(lockedTarget)}
      dismissible={!busy}
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
            <Text variant="footnote" color="danger" align="center" style={{ marginBottom: spacing[8] }}>
              {error}
            </Text>
          ) : null}
          {destinations.length === 0 ? (
            <Text variant="body" color="secondary" align="center">No other folders available.</Text>
          ) : (
            <ThemedFlatList
              data={destinations}
              keyExtractor={(d) => (isRootDestination(d) ? "root" : d.id)}
              renderItem={({ item }) => (
                <ContextMenuItem
                  role="button"
                  icon={isRootDestination(item) ? "bookmark-outline" : (item.icon ?? DEFAULT_FOLDER_ICON)}
                  label={isRootDestination(item) ? "Bookmarks" : item.name}
                  selected={Boolean(completed) && pickedId === (isRootDestination(item) ? null : item.id)}
                  leading={completed && pickedId === (isRootDestination(item) ? null : item.id)
                    ? <BookmarkMoveIndicator icon={isRootDestination(item) ? "bookmark-outline" : (item.icon ?? DEFAULT_FOLDER_ICON)} destination={completed.name} /> : undefined}
                  trailing={
                    isRootDestination(item) ? undefined : (
                      <>
                        {item.pinned ? <PinIcon size={14} color={palette.textTertiary} /> : null}
                        {item.protected ? <FolderLockIcon unlocked={destinationUnlocked(item.id)} size={14} /> : null}
                        <Text variant="monoSmall" color="tertiary">{item.bookmarkCount}</Text>
                      </>
                    )
                  }
                  onPress={() => void pick(item)}
                  disabled={busy && !(completed && pickedId === (isRootDestination(item) ? null : item.id))}
                  busy={!completed && busy && pickedId === (isRootDestination(item) ? null : item.id)}
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
