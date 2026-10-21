import React, { useCallback, useImperativeHandle, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { APP_NAME, formatHighlightQuote, type BookmarkDto, type HighlightDto } from "@ordo/shared";
import { HeaderIconButton } from "../ui/Header";
import { ContextMenu, ContextMenuItem } from "../ui/ContextMenu";
import { FloatingPanel } from "../ui/FloatingPanel";
import { PanelHeader } from "../ui/PanelHeader";
import { Button } from "../ui/Button";
import { Text } from "../ui/Text";
import { PressableScale } from "../ui/PressableScale";
import { MaterialIcon } from "../ui/MaterialIcon";
import { ThemedScrollView } from "../ui/ThemedScrollView";
import { LazyMount } from "../ui/LazyMount";
import { sheetMenuStyles } from "../ui/SheetActionRow";
import { EditTagsSheet } from "../tags/EditTagsSheet";
import { ReminderCustomPanel } from "../bookmarks/ReminderCustomPanel";
import { REMINDER_MENU_WIDTH, ReminderPresetItems, useSaveReminder } from "../bookmarks/ReminderFlow";
import { useServerInfo } from "../../hooks/queries";
import { useTheme } from "../../theme/ThemeProvider";
import { spacing } from "../../theme/tokens";
import { bookmarkCanBeArticle, bookmarkIsArticle } from "../../lib/bookmark-reader";
import { formatReminderWhen } from "../../lib/bookmark-reminders";
import { copyText } from "../../lib/copy-link";
import { domainFromUrl } from "../../lib/format";
import type { MenuAnchorRect } from "../../lib/menu-anchor";

export interface ReaderActionsHandle { close(): void }
interface ReaderActionsProps {
  bookmark: BookmarkDto;
  highlights: readonly HighlightDto[];
  hasHtml: boolean;
  hasContents: boolean;
  website: boolean;
  canRead: boolean;
  onOpen: () => void;
  onContents: () => void;
  onShare: () => void;
  onCopyLink: () => void;
  onOpenOriginal: () => void;
  onOpenExternal: () => void;
  onRefresh: () => void;
  onRead: () => void;
  onClassify: (asArticle: boolean) => void;
  onRemoveHighlight: (id: string) => void;
}

/** Overlay navigation owns its state beside the trigger. Opening an overflow,
 * navigating a page or closing a dialog must not reconcile the article pane,
 * its header, or the other already-used reader panels. */
export const ReaderActions = React.memo(React.forwardRef<ReaderActionsHandle, ReaderActionsProps>(function ReaderActions({
  bookmark, highlights, hasHtml, hasContents, website, canRead, onOpen, onContents,
  onShare, onCopyLink, onOpenOriginal, onOpenExternal, onRefresh, onRead, onClassify, onRemoveHighlight,
}, ref) {
  const { palette } = useTheme();
  const { data: serverInfo } = useServerInfo();
  const reminders = serverInfo?.reminders === true;
  const [page, setPage] = useState<"actions" | "highlights" | "tags" | "remind" | "remind-custom" | null>(null);
  const [anchor, setAnchor] = useState<MenuAnchorRect | null>(null);
  const close = useCallback(() => setPage(null), []);
  const showActions = useCallback(() => setPage("actions"), []);
  useImperativeHandle(ref, () => ({ close }), [close]);
  const { save: saveReminder, busy: reminderBusy } = useSaveReminder(
    bookmark, close, page === "remind" || page === "remind-custom",
  );
  const remindNow = useMemo(() => new Date(), [page, bookmark.id, bookmark.remindAt]);
  const run = (action: () => void) => { close(); action(); };

  return <>
    <HeaderIconButton name="ellipsis-horizontal" color={palette.text}
      accessibilityLabel={website ? "More page actions" : "More article actions"}
      onPress={(rect) => { setAnchor(rect); setPage("actions"); onOpen(); }} />
    <ContextMenu visible={page === "actions" || page === "remind"} onDismiss={close} anchor={anchor}
      width={reminders ? REMINDER_MENU_WIDTH : undefined}
      sessionKey={page ? bookmark.id : undefined} pageKey={page === "remind" ? "remind" : "actions"}>
      {page === "remind" ? <ReminderPresetItems bookmark={bookmark} now={remindNow} busy={reminderBusy}
        showBack onBack={() => setPage("actions")} onPick={saveReminder} onCustom={() => setPage("remind-custom")} /> : <>
        {hasContents ? <ContextMenuItem icon="list-outline" label="Table of contents" onPress={() => run(onContents)} /> : null}
        {hasHtml && !website ? <ContextMenuItem icon="color-fill-outline" label="Highlights" onPress={() => setPage("highlights")} /> : null}
        {website ? <ContextMenuItem icon="refresh-outline" label="Refresh" onPress={() => run(onRefresh)} /> : null}
        <ContextMenuItem icon="share-social-outline" label={website ? "Share page" : "Share article"} onPress={() => run(onShare)} />
        <ContextMenuItem icon="link-outline" label="Copy link" onPress={() => run(onCopyLink)} />
        <ContextMenuItem icon="pricetags-outline" label="Edit tags" onPress={() => setPage("tags")} />
        {reminders ? <ContextMenuItem icon="alarm-outline" label={bookmark.remindAt != null ? "Edit reminder" : "Remind"}
          trailing={bookmark.remindAt != null ? <Text variant="monoSmall" color="tertiary" numberOfLines={1}>
            {formatReminderWhen(bookmark.remindAt)}</Text> : undefined} onPress={() => setPage("remind")} /> : null}
        {website && canRead ? <ContextMenuItem icon="reader-outline" label={`Read in ${APP_NAME}`} onPress={() => run(onRead)} /> : null}
        {bookmarkIsArticle(bookmark) ? <ContextMenuItem icon="globe-outline" label="Mark as website" onPress={() => run(() => onClassify(false))} />
          : bookmarkCanBeArticle(bookmark) ? <ContextMenuItem icon="reader-outline" label="Mark as article" onPress={() => run(() => onClassify(true))} /> : null}
        <ContextMenuItem icon={website ? "open-outline" : "globe-outline"}
          label={website ? "Open in external browser" : "Open original"} onPress={() => run(website ? onOpenExternal : onOpenOriginal)} />
      </>}
    </ContextMenu>
    <EditTagsSheet visible={page === "tags"} bookmark={bookmark} onDismiss={close} />
    <ReminderCustomPanel visible={page === "remind-custom"} initialUnix={bookmark.remindAt ?? null} busy={reminderBusy}
      onDismiss={() => setPage("remind")} onConfirm={(unix) => saveReminder(unix)} />
    <LazyMount active={page === "highlights"}>
      {() => <ReaderHighlights visible={page === "highlights"} highlights={highlights}
        onDismiss={close} onActions={showActions} onRemove={onRemoveHighlight} />}
    </LazyMount>
  </>;
}));

/** A large highlight collection is never constructed just to open overflow.
 * After first use, memoization retains it untouched during other menu pages. */
const ReaderHighlights = React.memo(function ReaderHighlights({ visible, highlights, onDismiss, onActions, onRemove }: {
  visible: boolean;
  highlights: readonly HighlightDto[];
  onDismiss: () => void;
  onActions: () => void;
  onRemove: (id: string) => void;
}) {
  const { palette } = useTheme();
  return <FloatingPanel visible={visible} onDismiss={onDismiss}>
      <PanelHeader title="Highlights" subtitle={highlights.length === 0 ? "Select a passage in the article to save it." : undefined} />
      {highlights.length > 0 ? <ThemedScrollView style={styles.highlightList}>
        {highlights.map((row) => <View key={row.id} style={styles.highlightRow}>
          <PressableScale style={styles.highlightBody} onPress={() => void copyText(formatHighlightQuote(row.exact), "Highlight copied")}
            accessibilityRole="button" accessibilityLabel={`Copy highlight: ${formatHighlightQuote(row.exact)}`}>
            <Text variant="body" numberOfLines={3}>{formatHighlightQuote(row.exact)}</Text>
            {row.href ? <Text variant="monoSmall" color="secondary" numberOfLines={1} style={styles.highlightMeta}>
              {domainFromUrl(row.href)}</Text> : null}
          </PressableScale>
          <PressableScale style={styles.removeHit} onPress={() => onRemove(row.id)}
            accessibilityRole="button" accessibilityLabel="Remove highlight">
            <MaterialIcon name="trash-outline" size={18} color={palette.danger} />
          </PressableScale>
        </View>)}
      </ThemedScrollView> : null}
      <Button label="Article actions" variant="secondary" block onPress={onActions} style={sheetMenuStyles.cancel} />
    </FloatingPanel>;
});

const styles = StyleSheet.create({
  highlightList: { maxHeight: 420 },
  highlightRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: spacing[8], paddingVertical: spacing[8] },
  highlightBody: { flex: 1, minWidth: 0, minHeight: 48, justifyContent: "center" },
  highlightMeta: { marginTop: spacing[4] },
  removeHit: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
});
