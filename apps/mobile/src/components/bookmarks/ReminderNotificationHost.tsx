/**
 * Keeps local OS reminder pings in sync with the server, and handles Open /
 * Later on the system banner.
 */
import { useEffect } from "react";
import { AppState } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import type { BookmarkReminderDto } from "@ordo/shared";
import { bookmarksApi } from "../../lib/api/bookmarks";
import { qk } from "../../lib/api/query-keys";
import { queryClient } from "../../lib/query-client";
import { useAuthStore } from "../../store/auth";
import { useSetBookmarkReminder } from "../../hooks/use-bookmarks";
import { errorMessage } from "../../lib/error-message";
import {
  reminderLaterAt,
  reminderSetToast,
  type ReminderPingPayload,
} from "../../lib/bookmark-reminders";
import {
  reconcileReminderNotifications,
  subscribeReminderNotificationTaps,
} from "../../lib/reminder-notifications";
import { isBookmarkDeletePending } from "../../lib/undoable-delete";
import { toast } from "../ui/toast-store";

export function ReminderNotificationHost() {
  const router = useRouter();
  const status = useAuthStore((s) => s.status);
  const setReminder = useSetBookmarkReminder();
  const reminders = useQuery({
    queryKey: qk.reminders,
    queryFn: () => bookmarksApi.reminders(),
    enabled: status === "authenticated",
    staleTime: 15_000,
  });

  useEffect(() => {
    if (status !== "authenticated") return;
    const snooze = (payload: ReminderPingPayload) => {
      const rows = queryClient.getQueryData<BookmarkReminderDto[]>(qk.reminders);
      const row = rows?.find((item) => item.id === payload.bookmarkId);
      setReminder.mutate(
        {
          id: payload.bookmarkId,
          folderId: payload.folderId ?? row?.folderId ?? null,
          title: payload.title || row?.title || "",
          domain: payload.domain || row?.domain || "",
          remindAt: reminderLaterAt(),
        },
        {
          onSuccess: (updated) => {
            if (updated.remindAt != null) toast.success(reminderSetToast(updated.remindAt));
          },
          onError: (err) => toast.error(errorMessage(err, "Couldn't update this reminder.")),
        },
      );
    };
    return subscribeReminderNotificationTaps({
      onOpen: (payload) => router.push(`/reader/${payload.bookmarkId}`),
      onLater: snooze,
    });
  }, [router, setReminder, status]);

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
