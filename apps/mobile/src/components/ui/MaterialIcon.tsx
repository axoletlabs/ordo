/** Material icons with an adapter for persisted folder names and existing action APIs. */
import React from "react";
import type LegacyIcons from "@expo/vector-icons/Ionicons";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { iconGlyphStyle } from "../../theme/icon-glyph";
import { useTheme } from "../../theme/ThemeProvider";
type Name = keyof typeof LegacyIcons.glyphMap;
type MaterialName = keyof typeof MaterialIcons.glyphMap;
const names: Record<string, MaterialName> = {
  add: "add", remove: "remove", close: "close", search: "search", checkmark: "check", "checkmark-done": "done-all",
  "checkmark-circle": "check-circle", "close-circle": "cancel", "alert-circle": "error", "information-circle": "info",
  "arrow-back": "arrow-back", "arrow-forward": "arrow-forward", "arrow-up": "arrow-upward", "arrow-down": "arrow-downward",
  "chevron-back": "arrow-back", "chevron-forward": "chevron-right", "chevron-up": "expand-less", "chevron-down": "expand-more",
  "ellipsis-horizontal": "more-horiz", "ellipsis-vertical": "more-vert", options: "tune", filter: "filter-list",
  "swap-vertical": "sort", "swap-horizontal": "swap-horiz", "swap-horiz": "swap-horiz", "swap-horizontal-outline": "swap-horiz",
  "person-circle": "account-circle", person: "person", people: "people", settings: "settings", "color-palette": "palette",
  sunny: "light-mode", moon: "dark-mode", desktop: "desktop-windows", contrast: "contrast", pulse: "vibration",
  navigate: "navigation", list: "list", "phone-portrait": "smartphone", "tablet-landscape": "tablet", flash: "bolt",
  layers: "layers", bookmark: "bookmark", folder: "folder", book: "menu-book",
  reader: "article", "document-text": "article", document: "description", newspaper: "newspaper", library: "local-library",
  "folder-open-outline": "folder-open", "folder-open": "create-new-folder",
  star: "star", heart: "favorite", sparkles: "auto-awesome", globe: "language", compass: "explore", map: "map",
  location: "location-on", airplane: "flight", car: "directions-car", bicycle: "directions-bike", boat: "directions-boat",
  home: "home", business: "business", briefcase: "work", laptop: "laptop", server: "dns", cloud: "cloud",
  "cloud-offline": "cloud-off", "cloud-download": "cloud-download", "cloud-upload": "cloud-upload",
  "code-slash": "code", terminal: "terminal", bug: "bug-report", rocket: "rocket-launch", construct: "build",
  "hardware-chip": "memory", cube: "view-in-ar", albums: "photo-library", images: "photo-library", image: "image",
  camera: "photo-camera", videocam: "videocam", film: "movie", "musical-notes": "music-note", headset: "headset", mic: "mic",
  "game-controller": "sports-esports", "extension-puzzle": "extension", fitness: "fitness-center", barbell: "fitness-center",
  medical: "medical-services", restaurant: "restaurant", cafe: "local-cafe", wine: "wine-bar", cart: "shopping-cart",
  pricetags: "sell", pricetag: "sell", wallet: "account-balance-wallet", cash: "payments", chatbubbles: "forum",
  mail: "mail", "share-social": "share", share: "share", "share-social-outline": "share", link: "link", open: "open-in-new",
  trash: "delete", pencil: "edit", create: "edit", copy: "content-copy", clipboard: "content-paste", download: "download",
  refresh: "refresh", reload: "refresh", sync: "sync", "sync-circle": "sync", alarm: "alarm", calendar: "calendar-today",
  "calendar-number": "event", time: "schedule", timer: "timer", hourglass: "hourglass-empty", notifications: "notifications",
  "lock-closed": "lock", "lock-open": "lock-open", "finger-print": "fingerprint", key: "key", keypad: "pin",
  apps: "apps", grid: "grid-view", text: "text-fields", eye: "visibility", "eye-off": "visibility-off",
  "log-out": "logout", "log-in": "login", shield: "shield", "shield-checkmark": "verified-user",
  "shield-half": "security", warning: "warning", help: "help", "help-circle": "help", happy: "sentiment-satisfied",
  checkbox: "check-box", square: "check-box-outline-blank", "radio-button-off": "radio-button-unchecked",
  "radio-button-on": "radio-button-checked", pin: "push-pin", "color-fill": "format-color-fill", save: "save",
  "return-down-back": "keyboard-return", "arrow-undo": "undo", "arrow-redo": "redo", "resize": "fullscreen",
  "expand": "fullscreen", "contract": "fullscreen-exit", "speedometer": "speed", "volume-high": "volume-up",
  "git-commit": "commit", "git-branch": "account-tree", "git-network": "account-tree", "logo-github": "code",
  flask: "science", ribbon: "workspace-premium", browsers: "web-asset", "phone-landscape": "smartphone",
  "tablet-portrait": "tablet-android", "cloud-done": "cloud-done", "arrow-down-circle": "download-for-offline",
  "color-wand": "auto-fix-high", scan: "qr-code-scanner", "return-up-back": "reply",
  "ellipsis-horizontal-circle": "more-horiz", "chatbubble-ellipses": "chat",
  tv: "tv", play: "play-arrow", pause: "pause", stop: "stop", "play-skip-back": "skip-previous", "play-skip-forward": "skip-next",
  "hand-left": "touch-app", "hand-right": "touch-app", "remove-circle": "remove-circle", ellipse: "radio-button-unchecked",
  "mail-unread": "markunread", "mail-open": "drafts",
};
export function materialIconName(name: string): MaterialName {
  const base = name.replace(/-outline$|-sharp$/, "");
  return names[name] ?? names[base] ?? (base in MaterialIcons.glyphMap ? base as MaterialName : "folder");
}
export function MaterialIcon({ name, size = 24, color, style, accessible = false, ...props }: Omit<React.ComponentProps<typeof LegacyIcons>, "name"> & { name: Name }) {
  const { palette } = useTheme();
  const material = materialIconName(name);
  return <View {...props} accessible={accessible} aria-hidden={!accessible} style={[{ width: size, height: size, alignItems: "center", justifyContent: "center", flexShrink: 0 }, style as StyleProp<ViewStyle>]}>
    <MaterialIcons name={material} size={size} color={color ?? palette.onSurfaceVariant} accessible={false} style={iconGlyphStyle(size)} />
  </View>;
}
// The adapter preserves the public type accepted by stored folder DTOs.
MaterialIcon.glyphMap = MaterialIcons.glyphMap as unknown as typeof LegacyIcons.glyphMap;
