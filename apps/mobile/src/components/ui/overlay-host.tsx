/**
 * Root portal for menus, panels, and dialogs. Overlays render here instead of
 * in an RN Modal so open/close stays on the same window (no nested-modal gap,
 * no extra native window on every click).
 */
import React, { createContext, useContext, useLayoutEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";

type OverlayApi = {
  upsert: (id: string, node: React.ReactNode | null) => void;
};

const OverlayContext = createContext<OverlayApi | null>(null);

let nextId = 0;

export function OverlayHost({ children }: { children: React.ReactNode }) {
  const [layers, setLayers] = useState<{ id: string; node: React.ReactNode }[]>([]);
  const api = useMemo<OverlayApi>(
    () => ({
      upsert: (id, node) => {
        setLayers((prev) => {
          const without = prev.filter((layer) => layer.id !== id);
          if (node == null) return without;
          return [...without, { id, node }];
        });
      },
    }),
    [],
  );

  return (
    <OverlayContext.Provider value={api}>
      {children}
      <View
        pointerEvents={layers.length > 0 ? "box-none" : "none"}
        style={styles.host}
        collapsable={false}
      >
        {layers.map((layer) => (
          <React.Fragment key={layer.id}>{layer.node}</React.Fragment>
        ))}
      </View>
    </OverlayContext.Provider>
  );
}

/** Render `children` into the root overlay host. Falls back in-place if none. */
export function OverlayPortal({ children }: { children: React.ReactNode }) {
  const ctx = useContext(OverlayContext);
  const idRef = useRef<string>();
  if (!idRef.current) {
    nextId += 1;
    idRef.current = `overlay-${nextId}`;
  }
  const id = idRef.current;

  useLayoutEffect(() => {
    if (!ctx) return;
    ctx.upsert(id, children);
  });

  useLayoutEffect(() => {
    return () => ctx?.upsert(id, null);
  }, [ctx, id]);

  if (!ctx) return <>{children}</>;
  return null;
}

const styles = StyleSheet.create({
  host: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 80,
    elevation: 80,
  },
});
