import { useAuthStore } from "../store/auth";
import { useSettingsStore } from "../store/settings";

export type SessionScope = { server: string; generation: number };

/** Stable across access-token rotation, different after login/logout or a host switch. */
export function captureSessionScope(): SessionScope {
  return { server: useSettingsStore.getState().serverUrl.replace(/\/+$/, ""), generation: useAuthStore.getState().sessionGeneration };
}

export function isSessionScopeCurrent(scope: SessionScope): boolean {
  const current = captureSessionScope();
  return scope.server === current.server && scope.generation === current.generation;
}

export class SessionChangedError extends Error {
  readonly code = "session_changed";
  constructor() { super("The account or server changed. This request was cancelled."); this.name = "SessionChangedError"; }
}

export function assertSessionScope(scope: SessionScope): void {
  if (!isSessionScopeCurrent(scope)) throw new SessionChangedError();
}
