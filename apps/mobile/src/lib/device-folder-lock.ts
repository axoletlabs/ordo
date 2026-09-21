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
  const authentication = await LocalAuthentication.authenticateAsync({
    promptMessage: "Confirm your device lock",
    cancelLabel: "Cancel",
    disableDeviceFallback: false,
  });
  if (!authentication.success) throw new Error("Device authentication was unsuccessful.");
  const bytes = await Crypto.getRandomBytesAsync(32);
  const credential = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  await SecureStore.setItemAsync(keyFor(folderId), credential, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    requireAuthentication: true,
    authenticationPrompt: "Confirm your device lock",
  });
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
