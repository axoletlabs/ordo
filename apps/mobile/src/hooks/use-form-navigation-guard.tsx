import React from "react";
import { Platform } from "react-native";
import { useFocusEffect, useNavigation } from "expo-router";
// Expo Router ships its navigation context; a separate navigation package
// would subscribe to a different provider in this SDK.
import { usePreventRemove } from "expo-router/build/react-navigation/core";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";

/** Blocks header, Android Back, web history and native swipe-back together. */
export function useFormNavigationGuard(dirty: boolean) {
  const navigation = useNavigation();
  const action = React.useRef<(() => void) | null>(null);
  const [confirming, setConfirming] = React.useState(false);
  const [allowed, setAllowed] = React.useState(false);
  useFocusEffect(React.useCallback(() => { setAllowed(false); }, []));
  usePreventRemove(dirty && !allowed, ({ data }) => {
    action.current = () => navigation.dispatch(data.action);
    setConfirming(true);
  });
  React.useEffect(() => {
    if (!allowed) return;
    const next = action.current;
    action.current = null;
    next?.();
  }, [allowed]);
  React.useEffect(() => {
    if (Platform.OS !== "web" || !dirty || allowed) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty, allowed]);
  const finish = (next: () => void) => { action.current = next; setAllowed(true); };
  const confirmation = <ConfirmDialog visible={confirming} title="Discard changes?"
    message="Your unsaved changes will be lost." confirmLabel="Discard" cancelLabel="Keep editing"
    onDismiss={() => { action.current = null; setConfirming(false); }}
    onConfirm={() => { setConfirming(false); setAllowed(true); }} />;
  return { finish, confirmation };
}
