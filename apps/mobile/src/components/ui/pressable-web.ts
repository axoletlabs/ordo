import type { GestureResponderEvent, PressableProps } from "react-native";

export type WebPressKeyEvent = {
  key: string; repeat?: boolean; defaultPrevented?: boolean; target?: unknown; currentTarget?: unknown;
  preventDefault: () => void;
};

/** RN Web implements Space only for button roles, not selection controls. */
export function webSelectionKeys(props: PressableProps & { onKeyDown?: (event: WebPressKeyEvent) => void }) {
  return {
    onKeyDown: (event: WebPressKeyEvent) => {
      props.onKeyDown?.(event);
      const role = props.role ?? props.accessibilityRole;
      if (!event.defaultPrevented && event.target === event.currentTarget && (event.key === " " || event.key === "Spacebar") &&
        ["checkbox", "radio", "switch", "menuitemcheckbox", "menuitemradio"].includes(role ?? "")) {
        event.preventDefault();
        if (!props.disabled && !event.repeat) props.onPress?.(event as unknown as GestureResponderEvent);
      }
    },
  };
}
