/** Native stacks own native motion; web native-stack needs an explicit transition. */
import React, { startTransition, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Platform, View } from "react-native";
import { useFocusEffect, useNavigation, useRoute } from "expo-router";
import { materialWebMotion, useMaterialMotion } from "../../theme/material-motion";
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
  const { reducedMotion, expressive } = useMaterialMotion();
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
    // Required content must not wait indefinitely for an idle callback (or a
    // low-priority transition). Deep links can also miss transitionEnd.
    const fallback = setTimeout(() => {
      cancelWork?.();
      setReady(true);
    }, screenAnimationDuration(preference) + 150);
    return () => { unsubscribe(); clearTimeout(fallback); cancelWork?.(); };
  }, [immediate, navigation, preference, ready]);
  const settings = useRef({ reducedMotion, preference, expressive });
  settings.current = { reducedMotion, preference, expressive };
  const active = useRef<Animation[]>([]);
  useEffect(() => {
    if (reducedMotion || preference === "instant") active.current.forEach(animation => animation.cancel());
  }, [reducedMotion, preference]);
  useFocusEffect(useCallback(() => {
    const { reducedMotion, preference, expressive } = settings.current;
    if (Platform.OS !== "web" || reducedMotion || preference === "instant") return;
    const node = ref.current as unknown as HTMLElement | null;
    // No filled transform remains on the input ancestors after the transition.
    const animations = [node?.animate?.([{ opacity: 0.6 }, { opacity: 1 }], materialWebMotion.effects)];
    if (preference === "slide") animations.push(node?.animate?.([
      { transform: "translateX(24px)" }, { transform: "translateX(0)" },
    ], materialWebMotion[expressive ? "expressive" : "standard"]));
    active.current = animations.filter((animation): animation is Animation => animation != null);
    return () => { active.current.forEach(animation => animation.cancel()); active.current = []; };
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
