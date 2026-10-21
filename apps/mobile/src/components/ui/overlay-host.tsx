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
import { createOverlayRegistry, topBlockingLayer } from "../../lib/overlay-registry";
import { isolateModal } from "../../lib/modal-isolation";
import { AnimationActivityContext } from "../../hooks/use-animation-activity";

type OverlayApi = ReturnType<typeof createOverlayRegistry<React.ReactNode>>;

const OverlayContext = createContext<OverlayApi | null>(null);
const OverlayBlockedContext = createContext(false);
export const useOverlayBlocked = () => useContext(OverlayBlockedContext);

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
  return <OverlayBlockedContext.Provider value={blocked}>
    {/* Web already has inert isolation and a full-viewport blocking scrim.
        Toggling inherited CSS pointer-events here dirties the entire article
        subtree before a popup can paint. Native keeps its cheap hit-test gate. */}
    <View style={styles.background} pointerEvents={Platform.OS === "web" ? undefined : blocked ? "none" : "auto"}
      accessibilityElementsHidden={blocked} importantForAccessibility={blocked ? "no-hide-descendants" : "auto"}>
      <AnimationActivityContext.Provider value={!blocked}>{children}</AnimationActivityContext.Provider>
    </View>
  </OverlayBlockedContext.Provider>;
}

function OverlayLayers({ api }: { api: OverlayApi }) {
  const layers = useSyncExternalStore(api.subscribe, api.getLayers, api.getLayers);
  const host = useRef<View>(null);
  const topId = topBlockingLayer(layers);
  const topIndex = layers.findIndex((layer) => layer.id === topId);
  useLayoutEffect(() => {
    if (Platform.OS !== "web" || !topId) return;
    const root = (host.current as unknown as HTMLElement | null)?.querySelector<HTMLElement>(`[data-overlay-layer="${topId}"]`);
    if (root) return isolateModal(root);
  }, [topId]);

  return (
    <View
      ref={host}
      pointerEvents={layers.length > 0 ? "box-none" : "none"}
      style={styles.host}
      collapsable={false}
    >
      {layers.map((layer, index) => (
        <OverlayBlockedContext.Provider key={layer.id} value={index < topIndex}>
          <View pointerEvents={index < topIndex ? "none" : "box-none"}
            importantForAccessibility={index < topIndex ? "no-hide-descendants" : "auto"}
            accessibilityElementsHidden={index < topIndex}
            {...(Platform.OS === "web" ? { dataSet: { overlayLayer: layer.id } } : {})}
            style={StyleSheet.absoluteFill}>
            <AnimationActivityContext.Provider value={layer.active && index >= topIndex}>
              {layer.node}
            </AnimationActivityContext.Provider>
          </View>
        </OverlayBlockedContext.Provider>
      ))}
    </View>
  );
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
