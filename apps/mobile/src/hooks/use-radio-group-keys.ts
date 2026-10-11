import { Platform } from "react-native";
import type React from "react";
import { selectionIndex } from "../lib/selection-keyboard";

/** Arrow keys select without synthesizing a click (which may dismiss a picker). */
export function useRadioGroupKeys<T>(values: readonly T[], onChange: (value: T) => void, columns = 1) {
  return Platform.OS === "web" ? {
    onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
      const radios = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'));
      const index = radios.indexOf(event.target as HTMLElement);
      if (index < 0) return;
      const top = radios[0]?.getBoundingClientRect().top;
      const measuredColumns = columns > 1 ? radios.filter((radio) => Math.abs(radio.getBoundingClientRect().top - (top ?? 0)) < 1).length : 1;
      const next = selectionIndex(event.key, index, values.length, measuredColumns || columns);
      if (next == null || !radios[next]) return;
      event.preventDefault(); event.stopPropagation();
      onChange(values[next]!);
      radios[next].focus();
      radios[next].scrollIntoView({ block: "nearest", inline: "nearest" });
    },
  } : {};
}
