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
      if (!source.isFocused()) return false;
      const destination = appDestination(href);
      const state = stack?.getState();
      if (!stack || !destination || options || !state || !state.routeNames.includes(destination.name)) {
        if (!flight.begin(origin, true)) return false;
        const method = type === "PUSH" ? router.push : type === "REPLACE" ? router.replace : router.navigate;
        try { method(href, options); return true; }
        catch (error) { flight.release(origin); throw error; }
      }
      const current = state.routes[state.index];
      const currentParams = current.params as Record<string, unknown> | undefined;
      if (current.name === destination.name && currentParams?.id === destination.params.id) {
        if (Object.entries(destination.params).some(([key, value]) => currentParams?.[key] !== value)) {
          stack.dispatch({ type: "NAVIGATE", target: state.key, payload: destination });
          return true;
        }
        return false;
      }
      if (!flight.begin(origin, source.isFocused())) return false;
      try {
        stack.dispatch({ type, target: state.key, payload: destination });
        return true;
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
        if (!flight.begin(origin, source.isFocused())) return false;
        if (!stack) router.back(); else source.goBack();
        return true;
      },
    };
  }, [router, source, stack, origin]);
}
