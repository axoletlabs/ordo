/** Account identity and security settings. */
import React, { useState } from "react";
import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as FileSystem from "expo-file-system";
import {
  SettingsGroup,
  SettingsPage,
  SettingsScrollView,
} from "../../../src/components/settings/SettingsPage";
import { SettingRow } from "../../../src/components/ui/SettingRow";
import { UserAvatar } from "../../../src/components/ui/UserAvatar";
import { ContextMenu, ContextMenuItem } from "../../../src/components/ui/ContextMenu";
import { toast } from "../../../src/components/ui/toast-store";
import { useAuthStore } from "../../../src/store/auth";
import { useServerInfo } from "../../../src/hooks/queries";
import { authApi } from "../../../src/lib/api/auth";
import { errorMessage } from "../../../src/lib/error-message";
import { formatDate } from "../../../src/lib/format";
import { haptics } from "../../../src/lib/haptics";
import { spacing } from "../../../src/theme/tokens";
import { afterPress } from "../../../src/lib/after-press";
import { measureAnchor, type MenuAnchorRect } from "../../../src/lib/menu-anchor";

export default function AccountScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const { data: info } = useServerInfo();
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchorRect | null>(null);
  const avatarRef = React.useRef<View>(null);

  const afterSheet = (fn: () => void) => {
    setMenuOpen(false);
    afterPress(fn);
  };

  const uploadFromUri = async (uri: string) => {
    const maxBytes = info?.profilePictureMaxBytes ?? 2 * 1024 * 1024;
    setBusy(true);
    try {
      const square = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 1024 } }],
        { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG },
      );
      const fileInfo = await FileSystem.getInfoAsync(square.uri);
      if (fileInfo.exists && fileInfo.size > maxBytes) {
        toast.error("That image is too large.");
        return;
      }
      const form = new FormData();
      form.append("file", {
        uri: square.uri,
        name: "avatar.jpg",
        type: "image/jpeg",
      } as unknown as Blob);
      const updated = await authApi.uploadAvatar(form);
      setUser(updated);
      haptics.success();
      toast.success("Profile picture updated");
    } catch (e) {
      haptics.error();
      toast.error(errorMessage(e, "Couldn't upload that image."));
    } finally {
      setBusy(false);
    }
  };

  const choosePhoto = async () => {
    if (busy) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      toast.error("Photo library permission is required to set a profile picture.");
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });
    if (picked.canceled || !picked.assets[0]) return;
    await uploadFromUri(picked.assets[0].uri);
  };

  const takePhoto = async () => {
    if (busy) return;
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      toast.error("Camera permission is required to take a profile picture.");
      return;
    }
    const captured = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });
    if (captured.canceled || !captured.assets[0]) return;
    await uploadFromUri(captured.assets[0].uri);
  };

  const removePhoto = async () => {
    if (busy || !user?.hasAvatar) return;
    setBusy(true);
    try {
      const updated = await authApi.deleteAvatar();
      setUser(updated);
      haptics.success();
      toast.success("Profile picture removed");
    } catch (e) {
      haptics.error();
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsPage title="Account">
      <SettingsScrollView>
        <View ref={avatarRef} collapsable={false} style={{ alignSelf: "center" }}>
          <Pressable
            onPress={(event) => {
              if (busy) return;
              measureAnchor(avatarRef.current, (anchor) => {
                setMenuAnchor(anchor);
                setMenuOpen(true);
              }, event);
            }}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Profile picture"
            style={{
              paddingBottom: spacing[16],
              opacity: busy ? 0.6 : 1,
            }}
          >
            <UserAvatar user={user} size={72} />
          </Pressable>
        </View>

        <SettingsGroup compact>
          <SettingRow
            icon="person-outline"
            label="Display name"
            value={user?.displayName ?? "—"}
            onPress={() => router.push("/settings/display-name")}
            showChevron
          />
          <SettingRow
            icon="mail-outline"
            label="Email"
            value={user?.email ?? "—"}
            onPress={() => router.push("/settings/email")}
            showChevron
          />
          <SettingRow
            icon="lock-closed-outline"
            label="Password"
            value="*****"
            onPress={() => router.push("/settings/password")}
            showChevron
          />
          <SettingRow
            icon="shield-checkmark-outline"
            label="Authenticator"
            value={user?.mfaEnabled ? "On" : "Off"}
            onPress={() => router.push("/settings/security")}
            showChevron
          />
          <SettingRow
            icon="calendar-outline"
            label="Member since"
            value={user ? formatDate(user.createdAt) : "—"}
            divider={false}
          />
        </SettingsGroup>

        <SettingsGroup label="Danger zone">
          <SettingRow
            icon="trash-outline"
            label="Delete account"
            destructive
            onPress={() => router.push("/settings/delete-account")}
            showChevron
            divider={false}
          />
        </SettingsGroup>
      </SettingsScrollView>

      <ContextMenu visible={menuOpen} onDismiss={() => setMenuOpen(false)} anchor={menuAnchor}>
        <ContextMenuItem
          icon="image-outline"
          label="Choose photo"
          onPress={() => afterSheet(() => void choosePhoto())}
        />
        <ContextMenuItem
          icon="camera-outline"
          label="Take photo"
          onPress={() => afterSheet(() => void takePhoto())}
        />
        {user?.hasAvatar ? (
          <ContextMenuItem
            icon="trash-outline"
            label="Remove photo"
            tone="danger"
            onPress={() => afterSheet(() => void removePhoto())}
          />
        ) : null}
      </ContextMenu>
    </SettingsPage>
  );
}
