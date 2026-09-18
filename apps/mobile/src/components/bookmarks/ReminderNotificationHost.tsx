/**
 * Keeps local OS reminder pings in sync with the server, and handles Later /
 * Reschedule / Open on the system banner.
 */
import { useEffect, useMemo, useState } from "react";
import { AppState, useWindowDimensions } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { unixSeconds } from "@ordo/shared";
import { bookmarksApi } from "../../lib/api/bookmarks";
import { qk } from "../../lib/api/query-keys";
import { queryClient } from "../../lib/query-client";
import { useAuthStore } from "../../store/auth";
import { CONTEXT_MENU_WIDTH, type MenuAnchorRect } from "../../lib/menu-anchor";
import {
  reminderNotificationsReady,
  reconcileReminderNotifications,
  subscribeReminderNotificationTaps,
} from "../../lib/reminder-notifications";
import { isBookmarkDeletePending } from "../../lib/undoable-delete";
import type { ReminderPingPayload } from "../../lib/bookmark-reminders";
import { ReminderFlow } from "./ReminderFlow";

export function ReminderNotificationHost() {
  const router = useRouter();
  const status = useAuthStore((s) => s.status);
  const { width, height } = useWindowDimensions();
  const [edit, setEdit] = useState<ReminderPingPayload | null>(null);
  const reminders = useQuery({
    queryKey: qk.reminders,
    queryFn: () => bookmarksApi.reminders(),
    enabled: status === "authenticated",
    staleTime: 15_000,
  });

  useEffect(() => {
    if (status !== "authenticated") return;
    return subscribeReminderNotificationTaps({
      onOpen: (payload) => router.push(`/reader/${payload.bookmarkId}`),
      onLater: () => undefined,
      onReschedule: (payload) => setEdit(payload),
    });
  }, [router, status]);

  useEffect(() => {
    const rows = reminders.data;
    if (!rows) return;
    let cancelled = false;
    void reminderNotificationsReady().then(() => {
      if (cancelled) return;
      return reconcileReminderNotifications(rows.filter((row) => !isBookmarkDeletePending(row.id)));
    });
    return () => {
      cancelled = true;
    };
  }, [reminders.data]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void queryClient.invalidateQueries({ queryKey: qk.reminders });
    });
    return () => sub.remove();
  }, []);

  const editBookmark = useMemo(() => {
    if (!edit) return null;
    const row = reminders.data?.find((item) => item.id === edit.bookmarkId);
    return {
      id: edit.bookmarkId,
      folderId: edit.folderId ?? row?.folderId ?? null,
      title: edit.title || row?.title || "",
      domain: edit.domain || row?.domain || "",
      remindAt: edit.remindAt ?? row?.remindAt ?? unixSeconds(),
    };
  }, [edit, reminders.data]);

  const editAnchor = useMemo<MenuAnchorRect>(
    () => ({
      x: Math.max(0, (width - CONTEXT_MENU_WIDTH) / 2),
      y: Math.max(0, height * 0.38),
      width: CONTEXT_MENU_WIDTH,
      height: 1,
    }),
    [width, height],
  );

  return (
    <ReminderFlow
      visible={edit != null}
      bookmark={editBookmark}
      anchor={edit != null ? editAnchor : null}
      onDismiss={() => setEdit(null)}
    />
  );
}
