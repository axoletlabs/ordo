import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { Text } from "./Text";
import { useTheme } from "../../theme/ThemeProvider";
import { authApi } from "../../lib/api/auth";
import { displayInitials } from "../../lib/avatar";
import { imageDataUri } from "../../lib/avatar-image";
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
  const [broken, setBroken] = useState(false);
  const stamp = user?.avatarUpdatedAt ?? "";

  useEffect(() => {
    setBroken(false);
    if (!user?.hasAvatar) {
      setUri(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await authApi.getAvatar();
        const next = imageDataUri(new Uint8Array(await res.arrayBuffer()), res.headers.get("content-type"));
        if (!cancelled) setUri(next);
      } catch {
        if (!cancelled) setUri(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.hasAvatar, stamp]);

  const radius = size / 2;
  if (uri && !broken) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: radius }}
        contentFit="cover"
        cachePolicy="memory-disk"
        onError={() => setBroken(true)}
      />
    );
  }

  const bg = palette.secondaryContainer;
  return (
    <View
      style={[
        styles.fallback,
        { width: size, height: size, borderRadius: radius, backgroundColor: bg },
      ]}
    >
      <Text variant="titleMedium" style={{ color: palette.onSecondaryContainer, fontSize: size * 0.36, lineHeight: size * 0.5 }}>
        {displayInitials(user?.displayName ?? "")}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
});
