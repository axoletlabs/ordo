/**
 * Keeps local OS reminder pings in sync with the server, and opens the reader
 * when the user taps a notification.
 */
import React, { useEffect } from "react";
import { AppState } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { bookmarksApi } from "../../lib/api/bookmarks";
import { qk } from "../../lib/api/query-keys";
import { queryClient } from "../../lib/query-client";
import { useAuthStore } from "../../store/auth";
import {
  reconcileReminderNotifications,
  subscribeReminderNotificationTaps,
} from "../../lib/reminder-notifications";
import { isBookmarkDeletePending } from "../../lib/undoable-delete";

export function ReminderNotificationHost() {
  const router = useRouter();
  const status = useAuthStore((s) => s.status);
  const reminders = useQuery({
    queryKey: qk.reminders,
    queryFn: () => bookmarksApi.reminders(),
    enabled: status === "authenticated",
    staleTime: 15_000,
  });

  useEffect(() => {
    if (status !== "authenticated") return;
    return subscribeReminderNotificationTaps((bookmarkId) => {
      router.push(`/reader/${bookmarkId}`);
    });
  }, [router, status]);

  useEffect(() => {
    if (!reminders.data) return;
    void reconcileReminderNotifications(
      reminders.data.filter((row) => !isBookmarkDeletePending(row.id)),
    );
  }, [reminders.data]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void queryClient.invalidateQueries({ queryKey: qk.reminders });
    });
    return () => sub.remove();
  }, []);

  return null;
}
