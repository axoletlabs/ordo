/**
 * Maps the Ionicons-style names used across the app (and persisted folder
 * icons) onto Material Icons. Plain data with no React or font imports, so the
 * icon-font generator can load it under Node.
 */
export const LEGACY_ICON_NAMES: Record<string, string> = {
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

/**
 * Resolve an app icon name to a Material glyph name. `has` reports which
 * Material glyphs the shipped font contains; unknown names draw a folder.
 */
export function resolveMaterialIconName(name: string, has: (material: string) => boolean): string {
  const base = name.replace(/-outline$|-sharp$/, "");
  const mapped = LEGACY_ICON_NAMES[name] ?? LEGACY_ICON_NAMES[base];
  if (mapped && has(mapped)) return mapped;
  if (!mapped && has(base)) return base;
  return "folder";
}
