/**
 * Root portal for menus, panels, and dialogs. Overlays render here instead of
 * in an RN Modal so open/close stays on the same window (no nested-modal gap,
 * no extra native window on every click).
 *
 * Layer state lives in a sibling so publishing a menu does not re-render
 * the whole app tree (that hitch made closes look like a jump).
 *
 * This is not React's createPortal: the node is re-parented under OverlayHost,
 * so ThemeOverrideProvider in the publisher (the reader, for example) is not
 * an ancestor. OverlayPortal snapshots that palette and re-provides it here.
 */
import React, { createContext, useContext, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { ThemeOverrideProvider, useTheme } from "../../theme/ThemeProvider";
import { createOverlayRegistry, topBlockingLayer, type OverlayLayer } from "../../lib/overlay-registry";
import { isolateModal } from "../../lib/modal-isolation";
import { AnimationActivityContext, AnimationActivityScopeContext, createAnimationActivityScope } from "../../hooks/use-animation-activity";

type OverlayApi = ReturnType<typeof createOverlayRegistry<React.ReactNode>>;
type BlockingApi = Pick<OverlayApi, "subscribe" | "isBlocked">;

const OverlayContext = createContext<OverlayApi | null>(null);
const OverlayBlockedContext = createContext<BlockingApi | null>(null);
const BackgroundBlockingContext = createContext<OverlayApi | null>(null);
const NO_SUBSCRIBE = () => () => {};
const NOT_BLOCKED = () => false;
export function useOverlayBlocked() {
  const background = useContext(BackgroundBlockingContext);
  const layer = useContext(OverlayBlockedContext);
  const blocking = background ?? layer;
  return useSyncExternalStore(blocking?.subscribe ?? NO_SUBSCRIBE,
    blocking?.isBlocked ?? NOT_BLOCKED, blocking?.isBlocked ?? NOT_BLOCKED);
}

/** Effect-only global modal ownership for background focus guards. Unlike the
 * layer-local render hook, this updates committed refs/cancels pending takes
 * synchronously without re-rendering the covered search/header controls. */
export function useOverlayBlockingEffect(effect: (blocked: boolean) => void) {
  const api = useContext(OverlayContext);
  useLayoutEffect(() => {
    let disposed = false;
    let previous: boolean | undefined;
    const reconcile = () => {
      if (disposed) return;
      const blocked = api?.isBlocked() ?? false;
      if (blocked === previous) return;
      previous = blocked;
      effect(blocked);
    };
    const unsubscribe = api?.subscribe(reconcile);
    reconcile();
    return () => { disposed = true; unsubscribe?.(); };
  }, [api, effect]);
}

let nextId = 0;

export function OverlayHost({ children }: { children: React.ReactNode }) {
  const api = useMemo(() => createOverlayRegistry<React.ReactNode>(), []);

  return (
    <OverlayContext.Provider value={api}>
      <OverlayBackground api={api}>{children}</OverlayBackground>
      <OverlayLayers api={api} />
    </OverlayContext.Provider>
  );
}

function OverlayBackground({ api, children }: { api: OverlayApi; children: React.ReactNode }) {
  const blocked = useSyncExternalStore(api.subscribe, api.isBlocked, api.isBlocked);
  // Publish a stable scope and update it in a committed layout effect. The
  // legacy boolean stays true so it does not republish through every page
  // provider; only animation leaf hooks subscribe to the scope.
  const activity = useMemo(() => createAnimationActivityScope(), []);
  useLayoutEffect(() => { activity.setActive(!blocked); }, [activity, blocked]);
  // The background's provider identity never flips. Actual blocking consumers
  // subscribe at their leaves; publishing a menu must not propagate a changed
  // context through every article/list fiber merely to find those consumers.
  return <BackgroundBlockingContext.Provider value={api}>
    <OverlayBlockedContext.Provider value={null}>
    {/* Web already has inert isolation and a full-viewport blocking scrim.
        Toggling inherited CSS pointer-events here dirties the entire article
        subtree before a popup can paint. Native keeps its cheap hit-test gate. */}
    <View style={styles.background} pointerEvents={Platform.OS === "web" ? undefined : blocked ? "none" : "auto"}
      accessibilityElementsHidden={blocked} importantForAccessibility={blocked ? "no-hide-descendants" : "auto"}>
      <AnimationActivityScopeContext.Provider value={activity}>
        <AnimationActivityContext.Provider value={true}>{children}</AnimationActivityContext.Provider>
      </AnimationActivityScopeContext.Provider>
    </View>
    </OverlayBlockedContext.Provider>
  </BackgroundBlockingContext.Provider>;
}

function OverlayLayers({ api }: { api: OverlayApi }) {
  const layers = useSyncExternalStore(api.subscribe, api.getLayers, api.getLayers);
  const host = useRef<View>(null);
  const releaseIsolation = useRef<(() => void) | undefined>(undefined);
  const topId = topBlockingLayer(layers);
  const topIndex = layers.findIndex((layer) => layer.id === topId);
  useLayoutEffect(() => {
    if (Platform.OS !== "web") return;
    const root = topId ? (host.current as unknown as HTMLElement | null)?.querySelector<HTMLElement>(`[data-overlay-layer="${topId}"]`) : null;
    // Acquire the successor before releasing the old owner. Shared background
    // locks stay intact across picker/menu handoffs instead of toggling inert,
    // aria-hidden and document overflow off and straight back on.
    const next = root ? isolateModal(root) : undefined;
    releaseIsolation.current?.();
    releaseIsolation.current = next;
  }, [topId]);
  useLayoutEffect(() => () => {
    releaseIsolation.current?.();
    releaseIsolation.current = undefined;
  }, []);

  return (
    <BackgroundBlockingContext.Provider value={null}>
    <View
      ref={host}
      pointerEvents={layers.length > 0 ? "box-none" : "none"}
      style={styles.host}
      collapsable={false}
    >
      {layers.map((layer, index) => <OverlayLayerSurface key={layer.id} api={api} layer={layer} covered={index < topIndex} />)}
    </View>
    </BackgroundBlockingContext.Provider>
  );
}

function OverlayLayerSurface({ api, layer, covered }: { api: OverlayApi; layer: OverlayLayer<React.ReactNode>; covered: boolean }) {
  const [activity] = React.useState(() => createAnimationActivityScope(layer.active && !covered));
  useLayoutEffect(() => { activity.setActive(layer.active && !covered); }, [activity, layer.active, covered]);
  // Derive coverage directly from the registry, not a later effect/ref. Native
  // focus guards see the published owner immediately, including in dormant and
  // exiting layers, without a context walk through every retained control.
  const blocking = useMemo<BlockingApi>(() => ({ subscribe: api.subscribe, isBlocked: () => {
    const layers = api.getLayers();
    const index = layers.findIndex(candidate => candidate.id === layer.id);
    const topId = topBlockingLayer(layers);
    const top = layers.findIndex(candidate => candidate.id === topId);
    return index >= 0 && index < top;
  } }), [api, layer.id]);
  return <OverlayBlockedContext.Provider value={blocking}>
    <View pointerEvents={covered ? "none" : "box-none"}
      importantForAccessibility={covered ? "no-hide-descendants" : "auto"}
      accessibilityElementsHidden={covered}
      {...(Platform.OS === "web" ? { dataSet: { overlayLayer: layer.id } } : {})}
      style={StyleSheet.absoluteFill}>
      <AnimationActivityScopeContext.Provider value={activity}>
        <AnimationActivityContext.Provider value={true}>{layer.node}</AnimationActivityContext.Provider>
      </AnimationActivityScopeContext.Provider>
    </View>
  </OverlayBlockedContext.Provider>;
}

/** Render `children` into the root overlay host. Falls back in-place if none. */
export function OverlayPortal({ children, blocking = true, active = true }: { children: React.ReactNode; blocking?: boolean; active?: boolean }) {
  const ctx = useContext(OverlayContext);
  const { palette } = useTheme();
  const idRef = useRef<string | undefined>(undefined);
  if (!idRef.current) {
    nextId += 1;
    idRef.current = `overlay-${nextId}`;
  }
  const id = idRef.current;
  // Keep the published element stable until its contents or palette change.
  // Publishers re-render for their own state (search text, press feedback,
  // scroll offsets); rebuilding this node on every commit made the registry
  // notify OverlayLayers, which then reconciled every mounted layer.
  const node = useMemo(
    () => <ThemeOverrideProvider palette={palette}>{children}</ThemeOverrideProvider>,
    [children, palette],
  );

  useLayoutEffect(() => {
    if (!ctx) return;
    ctx.upsert(id, node, blocking, active);
  }, [ctx, id, node, blocking, active]);

  useLayoutEffect(() => {
    return () => ctx?.upsert(id, null);
  }, [ctx, id]);

  if (!ctx) return <>{children}</>;
  return null;
}

const styles = StyleSheet.create({
  background: { flex: 1 },
  host: {
    ...StyleSheet.absoluteFill,
    zIndex: 80,
    elevation: 80,
  },
});
