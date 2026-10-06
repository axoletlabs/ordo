/** Client-side fallback avatar: initials from the display name. */
export function displayInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
  }
  const compact = (parts[0] ?? name).replace(/\s+/g, "");
  return compact.slice(0, 2).toUpperCase() || "?";
}

