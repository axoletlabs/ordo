import { useCallback, useMemo } from "react";
import { useFocusEffect, useNavigation, useRoute, useRouter, type Href } from "expo-router";
import { appDestination, createNavigationFlight } from "../lib/app-navigation";

const flight = createNavigationFlight();

/** Keep URL/deep-link behavior, but dispatch known app screens in the press handler. */
export function useAppRouter() {
  const router = useRouter();
  const source = useNavigation();
  const route = useRoute();
  const stack = source.getParent("/(app)");
  const origin = route.key;
  useFocusEffect(useCallback(() => { flight.release(origin); }, [origin]));

  return useMemo(() => {
    const open = (href: Href, type: "PUSH" | "NAVIGATE" | "REPLACE", options?: Parameters<typeof router.push>[1]) => {
      const destination = appDestination(href);
      if (!stack || !destination || options) {
        const method = type === "PUSH" ? router.push : type === "REPLACE" ? router.replace : router.navigate;
        method(href, options);
        return;
      }
      const state = stack.getState();
      if (!state.routeNames.includes(destination.name)) {
        const method = type === "PUSH" ? router.push : type === "REPLACE" ? router.replace : router.navigate;
        method(href, options);
        return;
      }
      const current = state.routes[state.index];
      const currentParams = current.params as Record<string, unknown> | undefined;
      if (current.name === destination.name && currentParams?.id === destination.params.id) {
        if (Object.entries(destination.params).some(([key, value]) => currentParams?.[key] !== value))
          stack.dispatch({ type: "NAVIGATE", target: state.key, payload: destination });
        return;
      }
      if (!flight.begin(origin, source.isFocused())) return;
      try {
        stack.dispatch({ type, target: state.key, payload: destination });
      } catch (error) {
        flight.release(origin);
        throw error;
      }
    };
    return { ...router,
      push: (href: Href, options?: Parameters<typeof router.push>[1]) => open(href, "PUSH", options),
      navigate: (href: Href, options?: Parameters<typeof router.navigate>[1]) => open(href, "NAVIGATE", options),
      replace: (href: Href, options?: Parameters<typeof router.replace>[1]) => open(href, "REPLACE", options),
      back: () => {
        if (!stack) { router.back(); return; }
        if (flight.begin(origin, source.isFocused())) source.goBack();
      },
    };
  }, [router, source, stack, origin]);
}
