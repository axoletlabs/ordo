import type { PointerEvent, PressableProps } from "react-native";

export function isHoverPointer(event: Pick<PointerEvent, "nativeEvent">) {
  return event.nativeEvent.pointerType === "mouse" || event.nativeEvent.pointerType === "pen";
}

/** Only the fields the native pointer bridge forwards. Callers pass these
 * directly instead of copying their rendered props object on every render. */
export type NativeHoverSource = Pick<PressableProps, "disabled" | "onPointerEnter" | "onPointerLeave" | "onHoverIn" | "onHoverOut">;

/** Pressability's hover flag is off on native; opt in explicitly, not via private JS flags. */
export function nativeHoverEvents(props: NativeHoverSource, setHovered: (hovered: boolean) => void) {
  return {
    onPointerEnter: (event: PointerEvent) => {
      props.onPointerEnter?.(event);
      if (!props.disabled && isHoverPointer(event)) {
        setHovered(true);
        props.onHoverIn?.(event as unknown as Parameters<NonNullable<PressableProps["onHoverIn"]>>[0]);
      }
    },
    onPointerLeave: (event: PointerEvent) => {
      props.onPointerLeave?.(event);
      if (isHoverPointer(event)) {
        setHovered(false);
        props.onHoverOut?.(event as unknown as Parameters<NonNullable<PressableProps["onHoverOut"]>>[0]);
      }
    },
  };
}
