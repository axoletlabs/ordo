import type { PointerEvent, PressableProps } from "react-native";

export function isHoverPointer(event: Pick<PointerEvent, "nativeEvent">) {
  return event.nativeEvent.pointerType === "mouse" || event.nativeEvent.pointerType === "pen";
}

/** Pressability's hover flag is off on native; opt in explicitly, not via private JS flags. */
export function nativeHoverEvents(props: PressableProps, setHovered: (hovered: boolean) => void) {
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
