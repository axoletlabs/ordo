import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";

/** Kept-alive routes must not remain targets for the next screen's autofill. */
export function useCredentialLock(obscured = false): boolean {
  // A preloaded route can mount before it ever receives focus.
  const [focused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));
  return !focused || obscured;
}
