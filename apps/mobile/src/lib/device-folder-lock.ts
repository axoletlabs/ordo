import { Platform } from "react-native";
import * as Crypto from "expo-crypto";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";

const keyFor = (folderId: string) => `ordo.folderDeviceLock.${folderId}`;

export async function isDeviceLockAvailable(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  const [hardware, enrolled] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
  ]);
  return hardware && enrolled;
}

export async function createDeviceLockCredential(folderId: string): Promise<string> {
  // One prompt only: on Android, SecureStore shows its own (crypto-bound) biometric
  // prompt for requireAuthentication writes, so an extra authenticateAsync here would
  // ask twice. On iOS a first-time keychain add never authenticates, so confirm once
  // up front there. Reads authenticate on both platforms.
  if (Platform.OS === "ios") {
    const authentication = await LocalAuthentication.authenticateAsync({
      promptMessage: "Confirm your device lock",
      cancelLabel: "Cancel",
      disableDeviceFallback: false,
    });
    if (!authentication.success) throw new Error("Device authentication was unsuccessful.");
  }
  const bytes = await Crypto.getRandomBytesAsync(32);
  const credential = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  try {
    await SecureStore.setItemAsync(keyFor(folderId), credential, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      requireAuthentication: true,
      authenticationPrompt: "Confirm your device lock",
    });
  } catch (cause) {
    // SecureStore reports cancels/failures of its own prompt as plain errors;
    // normalize like the read side does.
    throw new Error("Device authentication was cancelled or unsuccessful.", { cause });
  }
  return credential;
}

export async function getDeviceLockCredential(folderId: string): Promise<string | null> {
  return SecureStore.getItemAsync(keyFor(folderId), {
    requireAuthentication: true,
    authenticationPrompt: "Unlock this folder",
  });
}

export async function deleteDeviceLockCredential(folderId: string): Promise<void> {
  await SecureStore.deleteItemAsync(keyFor(folderId));
}
