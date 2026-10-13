/**
 * Auth mutations. On success they update the auth store, which flips the root
 * gate. Errors are surfaced via the returned rejection (screens handle UI).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import {
  isMfaRequiredResponse,
  isPendingEmailVerificationResponse,
  normalizeReaderPreferences,
  type SessionDto,
  type UpdateReaderPreferencesInput,
  type UserDto,
} from "@ordo/shared";
import { queryClient } from "../lib/query-client";
import { authApi } from "../lib/api/auth";
import { useAuthStore } from "../store/auth";
import { useFolderTokenStore } from "../store/folder-tokens";
import { qk } from "../lib/api/query-keys";
import { ApiClientError, cancelProactiveRefresh, scheduleProactiveRefresh } from "../lib/api/client";
import { countsAsSignInFailure } from "../lib/telemetry-policy";
import { noteSignInFailure } from "../lib/telemetry";

export function useLogin() {
  const setSession = useAuthStore((s) => s.setSession);
  return useMutation({
    mutationFn: authApi.login,
    onSuccess: (data) => {
      if (isMfaRequiredResponse(data)) return;
      setSession(data);
      scheduleProactiveRefresh(data.tokens.expiresIn);
    },
    onError: noteRejectedSignIn,
  });
}

export function useRegister() {
  const setSession = useAuthStore((s) => s.setSession);
  return useMutation({
    mutationFn: authApi.register,
    onSuccess: (data) => {
      if (isPendingEmailVerificationResponse(data)) return;
      setSession(data);
      scheduleProactiveRefresh(data.tokens.expiresIn);
    },
  });
}

export function useVerifyEmail() {
  return useMutation({ mutationFn: authApi.verifyEmail });
}

export function useResendVerification() {
  return useMutation({ mutationFn: authApi.resendVerification });
}

/** Write an updated user into the auth store. */
function useUpdateUser() {
  const setUser = useAuthStore((s) => s.setUser);
  return (user: UserDto) => {
    setUser(user);
  };
}

export function useChangeDisplayName() {
  const updateUser = useUpdateUser();
  return useMutation({
    mutationFn: authApi.changeDisplayName,
    onSuccess: updateUser,
  });
}

export function useRequestEmailChange() {
  return useMutation({ mutationFn: authApi.requestEmailChange });
}

export function useResendEmailChange() {
  return useMutation({ mutationFn: authApi.resendEmailChange });
}

export function useVerifyEmailChange() {
  const updateUser = useUpdateUser();
  return useMutation({
    mutationFn: authApi.verifyEmailChange,
    onSuccess: updateUser,
  });
}

export function useChangePassword() {
  const setSession = useAuthStore((s) => s.setSession);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: authApi.changePassword,
    onSuccess: (data) => {
      setSession(data);
      scheduleProactiveRefresh(data.tokens.expiresIn);
      void qc.invalidateQueries({ queryKey: qk.sessions });
    },
  });
}

export function useForgotPassword() {
  return useMutation({ mutationFn: authApi.forgotPassword });
}

export function useResetPassword() {
  return useMutation({ mutationFn: authApi.resetPassword });
}

export function useDeleteAccount() {
  const clear = useAuthStore((s) => s.clear);
  return useMutation({
    mutationFn: authApi.deleteAccount,
    onSuccess: async () => {
      cancelProactiveRefresh();
      // The root layout stops persistence immediately and wipes the cache
      // once the sign-out crossfade has settled — see app/_layout.tsx.
      await Promise.allSettled([
        clear(),
        useFolderTokenStore.getState().clearAll(),
      ]);
    },
  });
}

export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: authApi.revokeSession,
    onMutate: (id) => {
      const prev = qc.getQueryData<SessionDto[]>(qk.sessions);
      qc.setQueryData<SessionDto[]>(qk.sessions, (old) => (old ?? []).filter((s) => s.id !== id));
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.sessions, ctx.prev);
    },
  });
}

/**
 * Account-synced reader preferences. Optimistically patched into the auth
 * store (and the persisted local account) with rollback on error; the server
 * response is canonical.
 */
export function useUpdateReaderPreferences() {
  const setUser = useAuthStore((s) => s.setUser);
  const mutation = useMutation({
    mutationKey: ["reader-preferences"],
    scope: { id: "reader-preferences" },
    mutationFn: ({ patch }: { patch: UpdateReaderPreferencesInput; prev: UserDto | null }) => authApi.updatePreferences(patch),
    onSuccess: (user) => {
      const current = useAuthStore.getState().user;
      const next = current && queryClient.isMutating({ mutationKey: ["reader-preferences"] }) > 1
        ? { ...user, preferences: current.preferences } : user;
      setUser(next);
    },
    onError: (_e, { prev }) => {
      if (prev && queryClient.isMutating({ mutationKey: ["reader-preferences"] }) === 1) setUser(prev);
    },
  });
  const enqueue = mutation.mutate;
  const mutate = useCallback((patch: UpdateReaderPreferencesInput) => {
    const prev = useAuthStore.getState().user;
    // Apply in the press handler, before React Query's asynchronous mutation lifecycle.
    if (prev) setUser({ ...prev, preferences: { ...normalizeReaderPreferences(prev.preferences), ...patch } });
    enqueue({ patch, prev });
  }, [setUser, enqueue]);
  return { ...mutation, mutate };
}

export function useLoginMfa() {
  const setSession = useAuthStore((s) => s.setSession);
  return useMutation({
    mutationFn: authApi.loginMfa,
    onSuccess: (data) => {
      setSession(data);
      scheduleProactiveRefresh(data.tokens.expiresIn);
    },
    onError: noteRejectedSignIn,
  });
}

export function useLoginMfaEmailVerify() {
  const setSession = useAuthStore((s) => s.setSession);
  return useMutation({
    mutationFn: authApi.loginMfaEmailVerify,
    onSuccess: (data) => {
      setSession(data);
      scheduleProactiveRefresh(data.tokens.expiresIn);
    },
    onError: noteRejectedSignIn,
  });
}

function noteRejectedSignIn(error: unknown): void {
  if (error instanceof ApiClientError && countsAsSignInFailure(error.status)) noteSignInFailure();
}

export function useLogout() {
  const clear = useAuthStore((s) => s.clear);
  return useMutation({
    mutationFn: async () => {
      try {
        await authApi.logout();
      } catch {
        /* logout is best-effort; if the access token is already expired the
           server returns 401 — we discard local state regardless. */
      }
    },
    onSettled: () => {
      cancelProactiveRefresh();
      // Cache teardown is owned by the root layout: it stops persistence at
      // once and wipes after the crossfade, so the outgoing library keeps
      // its painted rows while the sign-in screen fades in.
      void clear();
    },
  });
}
