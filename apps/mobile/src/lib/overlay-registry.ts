/** Stable ordering and a separate boolean snapshot keep overlay updates off the app tree. */
export type OverlayLayer<T> = { id: string; node: T; blocking: boolean; active: boolean };

export function createOverlayRegistry<T>() {
  let layers: OverlayLayer<T>[] = [];
  const listeners = new Set<() => void>();
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getLayers: () => layers,
    isBlocked: () => layers.some((layer) => layer.blocking),
    upsert(id: string, node: T | null, blocking = true, active = true) {
      const index = layers.findIndex((layer) => layer.id === id);
      if (node == null) {
        if (index < 0) return;
        layers = layers.filter((layer) => layer.id !== id);
      } else {
        const next = { id, node, blocking, active };
        if (index < 0) layers = [...layers, next];
        else {
          const previous = layers[index];
          if (previous.node === node && previous.blocking === blocking && previous.active === active) return;
          layers = layers.map((layer, i) => i === index ? next : layer);
        }
      }
      listeners.forEach((listener) => listener());
    },
  };
}

/** An exiting surface still protects the app, but must yield to a resumed parent. */
export function topBlockingLayer<T>(layers: OverlayLayer<T>[]): string | undefined {
  return layers.findLast((layer) => layer.blocking && layer.active)?.id
    ?? layers.findLast((layer) => layer.blocking)?.id;
}
