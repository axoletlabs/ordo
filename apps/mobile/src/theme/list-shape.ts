/** Expressive segmented lists have small inner corners and larger group edges. */
export type ListPosition = "first" | "middle" | "last" | "only";
export function listPosition(index: number, count: number): ListPosition {
  return count === 1 ? "only" : index === 0 ? "first" : index === count - 1 ? "last" : "middle";
}
export function listCorners(position: ListPosition, selected: boolean) {
  const top = selected || position === "first" || position === "only" ? 16 : 4;
  const bottom = selected || position === "last" || position === "only" ? 16 : 4;
  return { borderTopLeftRadius: top, borderTopRightRadius: top, borderBottomLeftRadius: bottom, borderBottomRightRadius: bottom };
}
