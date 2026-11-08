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
import { randomUUID } from "expo-crypto";
import { normalizeReaderPreferences, type AuthTokens, type UserDto } from "@ordo/shared";
import { accessExpiresAtFromNow } from "../lib/auth-session-policy";
import { shouldAdoptQuickShareSession } from "../lib/share-intake";
import { readQuickShareSession, syncQuickShareSession } from "../lib/share-targets";
import { secureGet, secureSet, secureDelete, StorageKeys } from "../lib/storage";
import { useSettingsStore } from "./settings";
import { createCoalescedPersistence } from "../lib/coalesced-persistence";
import { canonicalizeServerUrl } from "../lib/hosting";

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
    canRenameInstance: Boolean(u.canRenameInstance),
    createdAt: typeof u.createdAt === "string" ? u.createdAt : new Date(0).toISOString(),
  };
}

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

export interface PersistedAuth {
  sessionId?: string;
  /** Credentials belong to this origin even if a server switch is interrupted. */
  serverUrl?: string;
  user: UserDto;
  tokens: AuthTokens;
  /** Epoch ms when the access token expires. Client-stamped; not on the wire. */
  accessExpiresAt?: number;
  /** Epoch ms of the last token write; compared to the Quick Save session. */
  sessionUpdatedAt?: number;
}

export interface AuthState {
  sessionId: string | null;
  /** Runtime-only ownership boundary; token rotation does not change it. */
  sessionGeneration: number;
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

const saveAuth = createCoalescedPersistence<PersistedAuth | null>(payload => payload == null
  ? secureDelete(StorageKeys.AUTH) : secureSet(StorageKeys.AUTH, payload));

function persistAuth(
  user: UserDto,
  tokens: AuthTokens,
  accessExpiresAt: number | null,
  sessionUpdatedAt: number,
  sessionId: string,
  syncSidecar = true,
): void {
  const serverUrl = useSettingsStore.getState().serverUrl;
  const payload: PersistedAuth = { user, tokens, sessionUpdatedAt, serverUrl, sessionId };
  if (accessExpiresAt != null) payload.accessExpiresAt = accessExpiresAt;
  void saveAuth(payload);
  if (syncSidecar) void syncQuickShareSession({
    sessionId,
    serverUrl,
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
  sessionId: null,
  sessionGeneration: 0,
  user: null,
  tokens: null,
  accessExpiresAt: null,
  sessionUpdatedAt: null,
  status: "loading",

  hydrate: async () => {
    if (get().status !== "loading") return;
    const generation = get().sessionGeneration;
    const serverUrl = useSettingsStore.getState().serverUrl;
    const mayHydrate = () => get().status === "loading" &&
      get().sessionGeneration === generation && useSettingsStore.getState().serverUrl === serverUrl;
    const saved = await secureGet<PersistedAuth>(StorageKeys.AUTH);
    if (!mayHydrate()) return;
    void secureDelete(StorageKeys.RECOVERY_KEY);
    const user = normalizePersistedUser(saved?.user);
    const sameServer = saved?.serverUrl == null ||
      (typeof saved.serverUrl === "string" && canonicalizeServerUrl(saved.serverUrl) === serverUrl);
    if (sameServer && user && saved?.tokens?.accessToken && saved?.tokens?.refreshToken) {
      const sessionId = typeof saved.sessionId === "string" && saved.sessionId ? saved.sessionId : randomUUID();
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
      if (!mayHydrate()) return;
      if (shouldAdoptQuickShareSession(sessionUpdatedAt, sidecar) && sidecar.sessionId === sessionId && canonicalizeServerUrl(sidecar.serverUrl) === serverUrl) {
        tokens = tokensFromSidecar(tokens, sidecar);
        accessExpiresAt = sidecar.accessExpiresAt;
        sessionUpdatedAt = sidecar.updatedAt;
      }
      const nextUpdatedAt = sessionUpdatedAt ?? Date.now();
      set({
        sessionId,
        sessionGeneration: get().sessionGeneration + 1,
        user,
        tokens,
        accessExpiresAt,
        sessionUpdatedAt: nextUpdatedAt,
        status: "authenticated",
      });
      persistAuth(user, tokens, accessExpiresAt, nextUpdatedAt, sessionId);
    } else {
      // Partial/corrupt blob: drop it so it isn't re-parsed on every launch.
      if (saved) void saveAuth(null);
      set({
        sessionId: null,
        sessionGeneration: get().sessionGeneration + 1,
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
    const { user, tokens, sessionUpdatedAt, status, sessionGeneration, sessionId } = get();
    const serverUrl = useSettingsStore.getState().serverUrl;
    if (status !== "authenticated" || !user || !tokens || !sessionId) return;
    const sidecar = await readQuickShareSession();
    if (get().sessionGeneration !== sessionGeneration || get().tokens !== tokens || useSettingsStore.getState().serverUrl !== serverUrl) return;
    if (!shouldAdoptQuickShareSession(sessionUpdatedAt, sidecar)) return;
    if (sidecar.sessionId !== sessionId) return;
    if (canonicalizeServerUrl(sidecar.serverUrl) !== serverUrl) return;
    const nextTokens = tokensFromSidecar(tokens, sidecar);
    set({
      tokens: nextTokens,
      accessExpiresAt: sidecar.accessExpiresAt,
      sessionUpdatedAt: sidecar.updatedAt,
    });
    persistAuth(user, nextTokens, sidecar.accessExpiresAt, sidecar.updatedAt, sessionId);
  },

  setSession: (session) => {
    const accessExpiresAt = session.accessExpiresAt ?? accessExpiresAtFromNow(session.tokens.expiresIn);
    const sessionUpdatedAt = Date.now();
    const sessionId = randomUUID();
    set({
      sessionId,
      sessionGeneration: get().sessionGeneration + 1,
      user: session.user,
      tokens: session.tokens,
      accessExpiresAt,
      sessionUpdatedAt,
      status: "authenticated",
    });
    persistAuth(session.user, session.tokens, accessExpiresAt, sessionUpdatedAt, sessionId);
  },

  setTokens: (tokens) => {
    const { user, sessionId } = get();
    if (!user || !sessionId) return;
    const accessExpiresAt = accessExpiresAtFromNow(tokens.expiresIn);
    const sessionUpdatedAt = Date.now();
    set({ tokens, accessExpiresAt, sessionUpdatedAt });
    persistAuth(user, tokens, accessExpiresAt, sessionUpdatedAt, sessionId);
  },

  setUser: (user) => {
    const { tokens, accessExpiresAt, sessionUpdatedAt, sessionId } = get();
    if (!tokens || !sessionId) return;
    set({ user });
    // Profile/preferences edits leave the token-only Quick Save payload intact.
    persistAuth(user, tokens, accessExpiresAt, sessionUpdatedAt ?? Date.now(), sessionId, false);
  },

  clear: async () => {
    set({
      sessionId: null,
      sessionGeneration: get().sessionGeneration + 1,
      user: null,
      tokens: null,
      accessExpiresAt: null,
      sessionUpdatedAt: null,
      status: "unauthenticated",
    });
    await Promise.all([
      saveAuth(null),
      secureDelete(StorageKeys.RECOVERY_KEY),
      syncQuickShareSession(null),
    ]);
  },
}));
