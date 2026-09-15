/**
 * Auth mutations. On success they update the auth store, which flips the root
 * gate. Errors are surfaced via the returned rejection (screens handle UI).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  isMfaRequiredResponse,
  normalizeReaderPreferences,
  type SessionDto,
  type UpdateReaderPreferencesInput,
  type UserDto,
} from "@ordo/shared";
import { queryClient } from "../lib/query-client";
import { discardQueryCache } from "../lib/query-cache";
import { authApi } from "../lib/api/auth";
import { useAuthStore } from "../store/auth";
import { useFolderTokenStore } from "../store/folder-tokens";
import { qk } from "../lib/api/query-keys";
import { cancelProactiveRefresh, scheduleProactiveRefresh } from "../lib/api/client";

export function useLogin() {
  const setSession = useAuthStore((s) => s.setSession);
  return useMutation({
    mutationFn: authApi.login,
    onSuccess: (data) => {
      if (isMfaRequiredResponse(data)) return;
      setSession(data);
      scheduleProactiveRefresh(data.tokens.expiresIn);
    },
  });
}

export function useRegister() {
  const setSession = useAuthStore((s) => s.setSession);
  return useMutation({
    mutationFn: authApi.register,
    onSuccess: (data) => {
      setSession(data);
      scheduleProactiveRefresh(data.tokens.expiresIn);
    },
  });
}

export function useVerifyEmail() {
  return useMutation({ mutationFn: authApi.verifyEmail });
}

/** Write an updated user into the auth store + the `me` query cache. */
function useUpdateUser() {
  const setUser = useAuthStore((s) => s.setUser);
  return (user: UserDto) => {
    setUser(user);
    queryClient.setQueryData<UserDto>(qk.me, user);
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
      discardQueryCache();
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
  return useMutation({
    mutationFn: (patch: UpdateReaderPreferencesInput) => authApi.updatePreferences(patch),
    onMutate: (patch) => {
      const prev = useAuthStore.getState().user;
      if (prev) {
        setUser({
          ...prev,
          preferences: { ...normalizeReaderPreferences(prev.preferences), ...patch },
        });
      }
      return { prev };
    },
    onSuccess: (user) => {
      setUser(user);
      queryClient.setQueryData<UserDto>(qk.me, user);
    },
    onError: (_e, _patch, ctx) => {
      if (ctx?.prev) setUser(ctx.prev);
    },
  });
}

export function useLoginMfa() {
  const setSession = useAuthStore((s) => s.setSession);
  return useMutation({
    mutationFn: authApi.loginMfa,
    onSuccess: (data) => {
      setSession(data);
      scheduleProactiveRefresh(data.tokens.expiresIn);
    },
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
  });
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
      discardQueryCache();
      void clear();
    },
  });
}
