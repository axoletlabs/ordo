/**
 * Persistence layer.
 * - Secrets (auth tokens, folder unlock tokens) → expo-secure-store (Keychain/Keystore).
 * - Non-secret UI prefs (server URL, theme, amoled) → AsyncStorage.
 *
 * All functions are fail-safe: they resolve to null/void instead of throwing,
 * so a storage hiccup never crashes the app.
 */
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";

/** Read a JSON-serializable value from the secure store. */
export async function secureGet<T = any>(key: string): Promise<T | null> {
  try {
    const raw = await SecureStore.getItem(key);
    return raw == null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

/** Write a JSON-serializable value to the secure store. */
export async function secureSet(key: string, value: unknown): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, JSON.stringify(value), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED,
    });
  } catch {
    /* ignore — best effort */
  }
}

/** Delete a secure-store key. */
export async function secureDelete(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    /* ignore */
  }
}

/** Read a JSON value from preferences (AsyncStorage). */
export async function prefsGet<T = any>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw == null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

/** Write a JSON value to preferences. */
export async function prefsSet(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

/** Delete a preferences key. */
export async function prefsDelete(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Storage keys, centralised so they never drift. */
export const StorageKeys = {
  AUTH: "ordo.auth",
  SETTINGS: "ordo.settings",
  FOLDER_TOKENS: "ordo.folderTokens",
  NATIVE_UPDATE: "ordo.nativeUpdate",
  IMPORT_JOB: "ordo.importJob",
  REMINDER_FIRED: "ordo.reminderFired",
  REMINDER_ARMED: "ordo.reminderArmed",
  REMINDER_ACTIONS_REV: "ordo.reminderActionsRev",
  REMINDER_EXACT_ALARM_ASKED: "ordo.reminderExactAlarmAsked",
} as const;
