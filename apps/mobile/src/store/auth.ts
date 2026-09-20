/**
 * Auth store: the current user + opaque token pair.
 * Tokens live in expo-secure-store (Keychain/Keystore), NOT AsyncStorage.
 *
 * Tokens are opaque (sha256-hashed server-side); we cannot decode expiry, so we
 * stamp `accessExpiresAt` when a pair arrives and the API client refreshes from
 * that (with `token_expired` / `unauthorized` as the fallback).
 *
 * Android Quick Save also snapshots the pair to EncryptedSharedPreferences so
 * the translucent share activity can POST without launching React. Native
 * refresh writes that copy back; we adopt it on hydrate and foreground.
 */
import { create } from "zustand";
import { normalizeReaderPreferences, type AuthTokens, type UserDto } from "@ordo/shared";
import { accessExpiresAtFromNow } from "../lib/auth-session-policy";
import { shouldAdoptQuickShareSession } from "../lib/share-intake";
import { readQuickShareSession, syncQuickShareSession } from "../lib/share-targets";
import { secureGet, secureSet, secureDelete, StorageKeys } from "../lib/storage";
import { useSettingsStore } from "./settings";

/** Accept current UserDto rows and older persisted sessions that still have `username`. */
export function normalizePersistedUser(raw: unknown): UserDto | null {
  if (!raw || typeof raw !== "object") return null;
  const u = raw as Record<string, unknown>;
  if (typeof u.id !== "string" || typeof u.email !== "string") return null;
  const displayName =
    typeof u.displayName === "string" && u.displayName.trim()
      ? u.displayName
      : typeof u.username === "string"
        ? u.username
        : "";
  if (!displayName) return null;
  return {
    id: u.id,
    displayName,
    email: u.email,
    emailVerified: Boolean(u.emailVerified),
    hasAvatar: Boolean(u.hasAvatar),
    avatarUpdatedAt: typeof u.avatarUpdatedAt === "string" ? u.avatarUpdatedAt : null,
    mfaEnabled: Boolean(u.mfaEnabled),
    preferences: normalizeReaderPreferences(u.preferences),
    libraryEncrypted: Boolean(u.libraryEncrypted),
    createdAt: typeof u.createdAt === "string" ? u.createdAt : new Date(0).toISOString(),
  };
}

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

export interface PersistedAuth {
  user: UserDto;
  tokens: AuthTokens;
  /** Epoch ms when the access token expires. Client-stamped; not on the wire. */
  accessExpiresAt?: number;
  /** Epoch ms of the last token write; compared to the Quick Save session. */
  sessionUpdatedAt?: number;
}

export interface AuthState {
  user: UserDto | null;
  tokens: AuthTokens | null;
  accessExpiresAt: number | null;
  sessionUpdatedAt: number | null;
  status: AuthStatus;

  hydrate: () => Promise<void>;
  /** Pull tokens the Android Quick Save activity may have rotated. */
  reconcileShareSession: () => Promise<void>;
  setSession: (session: PersistedAuth) => void;
  /** Replace only the token pair (used after transparent refresh). */
  setTokens: (tokens: AuthTokens) => void;
  /** Replace only the user (used after profile edits). */
  setUser: (user: UserDto) => void;
  clear: () => Promise<void>;
}

function persistAuth(
  user: UserDto,
  tokens: AuthTokens,
  accessExpiresAt: number | null,
  sessionUpdatedAt: number,
): void {
  const payload: PersistedAuth = { user, tokens, sessionUpdatedAt };
  if (accessExpiresAt != null) payload.accessExpiresAt = accessExpiresAt;
  void secureSet(StorageKeys.AUTH, payload);
  void syncQuickShareSession({
    serverUrl: useSettingsStore.getState().serverUrl,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    accessExpiresAt,
    updatedAt: sessionUpdatedAt,
  });
}

function tokensFromSidecar(current: AuthTokens, sidecar: {
  accessToken: string;
  refreshToken: string;
}): AuthTokens {
  return {
    ...current,
    accessToken: sidecar.accessToken,
    refreshToken: sidecar.refreshToken,
  };
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  tokens: null,
  accessExpiresAt: null,
  sessionUpdatedAt: null,
  status: "loading",

  hydrate: async () => {
    const saved = await secureGet<PersistedAuth>(StorageKeys.AUTH);
    void secureDelete(StorageKeys.RECOVERY_KEY);
    const user = normalizePersistedUser(saved?.user);
    if (user && saved?.tokens?.accessToken && saved?.tokens?.refreshToken) {
      let tokens = saved.tokens;
      let accessExpiresAt =
        typeof saved.accessExpiresAt === "number" && Number.isFinite(saved.accessExpiresAt)
          ? saved.accessExpiresAt
          : null;
      let sessionUpdatedAt =
        typeof saved.sessionUpdatedAt === "number" && Number.isFinite(saved.sessionUpdatedAt)
          ? saved.sessionUpdatedAt
          : null;
      const sidecar = await readQuickShareSession();
      if (shouldAdoptQuickShareSession(sessionUpdatedAt, sidecar)) {
        tokens = tokensFromSidecar(tokens, sidecar);
        accessExpiresAt = sidecar.accessExpiresAt;
        sessionUpdatedAt = sidecar.updatedAt;
      }
      const nextUpdatedAt = sessionUpdatedAt ?? Date.now();
      set({
        user,
        tokens,
        accessExpiresAt,
        sessionUpdatedAt: nextUpdatedAt,
        status: "authenticated",
      });
      persistAuth(user, tokens, accessExpiresAt, nextUpdatedAt);
    } else {
      set({
        user: null,
        tokens: null,
        accessExpiresAt: null,
        sessionUpdatedAt: null,
        status: "unauthenticated",
      });
      void syncQuickShareSession(null);
    }
  },

  reconcileShareSession: async () => {
    const { user, tokens, sessionUpdatedAt, status } = get();
    if (status !== "authenticated" || !user || !tokens) return;
    const sidecar = await readQuickShareSession();
    if (!shouldAdoptQuickShareSession(sessionUpdatedAt, sidecar)) return;
    const nextTokens = tokensFromSidecar(tokens, sidecar);
    set({
      tokens: nextTokens,
      accessExpiresAt: sidecar.accessExpiresAt,
      sessionUpdatedAt: sidecar.updatedAt,
    });
    persistAuth(user, nextTokens, sidecar.accessExpiresAt, sidecar.updatedAt);
  },

  setSession: (session) => {
    const accessExpiresAt = session.accessExpiresAt ?? accessExpiresAtFromNow(session.tokens.expiresIn);
    const sessionUpdatedAt = Date.now();
    set({
      user: session.user,
      tokens: session.tokens,
      accessExpiresAt,
      sessionUpdatedAt,
      status: "authenticated",
    });
    persistAuth(session.user, session.tokens, accessExpiresAt, sessionUpdatedAt);
  },

  setTokens: (tokens) => {
    const user = get().user;
    if (!user) return;
    const accessExpiresAt = accessExpiresAtFromNow(tokens.expiresIn);
    const sessionUpdatedAt = Date.now();
    set({ tokens, accessExpiresAt, sessionUpdatedAt });
    persistAuth(user, tokens, accessExpiresAt, sessionUpdatedAt);
  },

  setUser: (user) => {
    const { tokens, accessExpiresAt, sessionUpdatedAt } = get();
    if (!tokens) return;
    set({ user });
    persistAuth(user, tokens, accessExpiresAt, sessionUpdatedAt ?? Date.now());
  },

  clear: async () => {
    set({
      user: null,
      tokens: null,
      accessExpiresAt: null,
      sessionUpdatedAt: null,
      status: "unauthenticated",
    });
    await Promise.all([
      secureDelete(StorageKeys.AUTH),
      secureDelete(StorageKeys.RECOVERY_KEY),
      syncQuickShareSession(null),
    ]);
  },
}));
