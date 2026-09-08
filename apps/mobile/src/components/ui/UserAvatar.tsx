import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { Text } from "./Text";
import { useTheme } from "../../theme/ThemeProvider";
import { authApi } from "../../lib/api/auth";
import { avatarColor, displayInitials } from "../../lib/avatar";
import type { UserDto } from "@ordo/shared";

export function UserAvatar({
  user,
  size = 64,
}: {
  user: Pick<UserDto, "id" | "displayName" | "hasAvatar" | "avatarUpdatedAt"> | null | undefined;
  size?: number;
}) {
  const { palette } = useTheme();
  const [uri, setUri] = useState<string | null>(null);
  const stamp = user?.avatarUpdatedAt ?? "";

  useEffect(() => {
    if (!user?.hasAvatar) {
      setUri(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await authApi.getAvatar();
        const dataUri = await responseToDataUri(res);
        if (!cancelled) setUri(dataUri);
      } catch {
        if (!cancelled) setUri(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.hasAvatar, stamp]);

  const radius = size / 2;
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: radius }}
        contentFit="cover"
        cachePolicy="memory-disk"
      />
    );
  }

  const bg = user ? avatarColor(user.id || user.displayName) : palette.surfaceSecondary;
  return (
    <View
      style={[
        styles.fallback,
        { width: size, height: size, borderRadius: radius, backgroundColor: bg },
      ]}
    >
      <Text variant="title1" style={{ color: "#fff", fontSize: size * 0.36 }}>
        {displayInitials(user?.displayName ?? "")}
      </Text>
    </View>
  );
}

function responseToDataUri(res: Response): Promise<string> {
  const mime = res.headers.get("content-type") || "image/webp";
  return res.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    const chunk = 0x8000;
    let binary = "";
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return `data:${mime};base64,${btoa(binary)}`;
  });
}

const styles = StyleSheet.create({
  fallback: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
});
