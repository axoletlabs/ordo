/**
 * Auth store: the current user + opaque token pair.
 * Tokens live in expo-secure-store (Keychain/Keystore), NOT AsyncStorage.
 *
 * Tokens are opaque (sha256-hashed server-side); we cannot decode expiry, so we
 * stamp `accessExpiresAt` when a pair arrives and the API client refreshes from
 * that (with `token_expired` / `unauthorized` as the fallback).
 */
import { create } from "zustand";
import { normalizeReaderPreferences, type AuthTokens, type UserDto } from "@ordo/shared";
import { accessExpiresAtFromNow } from "../lib/auth-session-policy";
import { secureGet, secureSet, secureDelete, StorageKeys } from "../lib/storage";

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
    createdAt: typeof u.createdAt === "string" ? u.createdAt : new Date(0).toISOString(),
  };
}

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

export interface PersistedAuth {
  user: UserDto;
  tokens: AuthTokens;
  /** Epoch ms when the access token expires. Client-stamped; not on the wire. */
  accessExpiresAt?: number;
}

export interface AuthState {
  user: UserDto | null;
  tokens: AuthTokens | null;
  accessExpiresAt: number | null;
  status: AuthStatus;

  hydrate: () => Promise<void>;
  setSession: (session: PersistedAuth) => void;
  /** Replace only the token pair (used after transparent refresh). */
  setTokens: (tokens: AuthTokens) => void;
  /** Replace only the user (used after profile edits). */
  setUser: (user: UserDto) => void;
  clear: () => Promise<void>;
}

function persistAuth(user: UserDto, tokens: AuthTokens, accessExpiresAt: number | null): void {
  const payload: PersistedAuth = { user, tokens };
  if (accessExpiresAt != null) payload.accessExpiresAt = accessExpiresAt;
  void secureSet(StorageKeys.AUTH, payload);
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  tokens: null,
  accessExpiresAt: null,
  status: "loading",

  hydrate: async () => {
    const saved = await secureGet<PersistedAuth>(StorageKeys.AUTH);
    const user = normalizePersistedUser(saved?.user);
    if (user && saved?.tokens?.accessToken && saved?.tokens?.refreshToken) {
      const accessExpiresAt =
        typeof saved.accessExpiresAt === "number" && Number.isFinite(saved.accessExpiresAt)
          ? saved.accessExpiresAt
          : null;
      set({ user, tokens: saved.tokens, accessExpiresAt, status: "authenticated" });
      persistAuth(user, saved.tokens, accessExpiresAt);
    } else {
      set({ user: null, tokens: null, accessExpiresAt: null, status: "unauthenticated" });
    }
  },

  setSession: (session) => {
    const accessExpiresAt = session.accessExpiresAt ?? accessExpiresAtFromNow(session.tokens.expiresIn);
    set({
      user: session.user,
      tokens: session.tokens,
      accessExpiresAt,
      status: "authenticated",
    });
    persistAuth(session.user, session.tokens, accessExpiresAt);
  },

  setTokens: (tokens) => {
    const user = get().user;
    if (!user) return;
    const accessExpiresAt = accessExpiresAtFromNow(tokens.expiresIn);
    set({ tokens, accessExpiresAt });
    persistAuth(user, tokens, accessExpiresAt);
  },

  setUser: (user) => {
    const { tokens, accessExpiresAt } = get();
    if (!tokens) return;
    set({ user });
    persistAuth(user, tokens, accessExpiresAt);
  },

  clear: async () => {
    set({ user: null, tokens: null, accessExpiresAt: null, status: "unauthenticated" });
    await secureDelete(StorageKeys.AUTH);
  },
}));
