/** Native stacks own native motion; web native-stack needs an explicit transition. */
import React, { startTransition, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Platform, View } from "react-native";
import { useFocusEffect, useNavigation, useRoute } from "expo-router";
import { useMaterialMotion } from "../../theme/material-motion";
import { useSettingsStore } from "../../store/settings";
import { AnimationActivityContext } from "../../hooks/use-animation-activity";
import { SceneReadyContext } from "../../hooks/use-scene-ready";
import { screenAnimationDuration } from "../../lib/navigation-animation";
import { scheduleIdleWork } from "../../lib/idle-work";

export function PageTransition({ children }: { children: React.ReactNode }) {
  const ref = useRef<View>(null);
  const [focused, setFocused] = useState(true);
  const parentActive = useContext(AnimationActivityContext);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => {
      setFocused(false);
      if (Platform.OS !== "web") return;
      const node = ref.current as unknown as HTMLElement | null;
      const focused = document.activeElement;
      // Web stacks retain outgoing screens under aria-hidden. Release only
      // this screen's focus; never blur a field already chosen on the next one.
      if (focused instanceof HTMLElement && node?.contains(focused)) focused.blur();
    };
  }, []));
  const { reducedMotion } = useMaterialMotion();
  const preference = useSettingsStore((state) => state.navigationAnimation);
  const navigation = useNavigation();
  const route = useRoute();
  const immediate = Platform.OS === "web" || reducedMotion || preference === "instant";
  const [ready, setReady] = useState(() => immediate || navigation.getState()?.routes[0]?.key === route.key);
  useLayoutEffect(() => {
    if (ready) return;
    if (immediate) { setReady(true); return; }
    let cancelWork: (() => void) | undefined;
    const finish = () => {
      if (cancelWork) return;
      cancelWork = scheduleIdleWork(() => startTransition(() => setReady(true)));
    };
    // Expo exports the base navigation type, not the native-stack event map.
    const stack = navigation as typeof navigation & {
      addListener(event: "transitionEnd", listener: (event: { data: { closing: boolean } }) => void): () => void;
    };
    const unsubscribe = stack.addListener("transitionEnd", (event) => { if (!event.data.closing) finish(); });
    // Deep links/restored scenes can mount without a transition event.
    const fallback = setTimeout(finish, screenAnimationDuration(preference) + 150);
    return () => { unsubscribe(); clearTimeout(fallback); cancelWork?.(); };
  }, [immediate, navigation, preference, ready]);
  const settings = useRef({ reducedMotion, preference });
  settings.current = { reducedMotion, preference };
  const active = useRef<Animation | undefined>(undefined);
  useEffect(() => {
    if (reducedMotion || preference === "instant") active.current?.cancel();
  }, [reducedMotion, preference]);
  useFocusEffect(useCallback(() => {
    const { reducedMotion, preference } = settings.current;
    if (Platform.OS !== "web" || reducedMotion || preference === "instant") return;
    const node = ref.current as unknown as HTMLElement | null;
    // No filled transform remains on the input ancestors after the transition.
    const animation = node?.animate?.([
      { opacity: 0.6, transform: preference === "slide" ? "translateX(24px)" : "none" },
      { opacity: 1, transform: "none" },
    ], { duration: 250, easing: "cubic-bezier(0.2, 0, 0, 1)" });
    active.current = animation;
    return () => { animation?.cancel(); active.current = undefined; };
    // Preferences affect the NEXT navigation, not an already-focused settings
    // page. Otherwise choosing a transition replays that page's entrance.
  }, []));
  const page = <View ref={ref} testID="material-page-transition" style={{ flex: 1 }}>{children}</View>;
  // A translated incoming page must not enlarge the browser's root scroller.
  // Clip at the scene viewport, not at the inner constrained content column;
  // dialogs/menus already live in the root portal outside this boundary.
  return <SceneReadyContext.Provider value={ready}>
    <AnimationActivityContext.Provider value={parentActive && focused && ready}>
    {Platform.OS === "web" ? <View style={{ flex: 1, overflow: "hidden" }}>{page}</View> : page}
  </AnimationActivityContext.Provider></SceneReadyContext.Provider>;
}
