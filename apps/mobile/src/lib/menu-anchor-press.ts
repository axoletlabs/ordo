import type { MenuAnchorRect } from "./menu-anchor";

/** Measure during press-in, before feedback dirties layout. A successful tap
 * consumes that gesture's result; a cancelled gesture can never open a menu. */
export function createMenuAnchorPress<Event>(
  measure: (done: (anchor: MenuAnchorRect) => void, event: Event) => void,
) {
  type Request = { anchor?: MenuAnchorRect; activate?: (anchor: MenuAnchorRect) => void };
  let current: Request | null = null;
  const begin = (event: Event, activate?: Request["activate"]) => {
    const request: Request = { activate };
    current = request;
    measure((anchor) => {
      if (current !== request) return;
      request.anchor = anchor;
      if (!request.activate) return;
      current = null;
      request.activate(anchor);
    }, event);
  };
  return {
    prepare(event: Event) { begin(event); },
    activate(event: Event, action: (anchor: MenuAnchorRect) => void) {
      if (!current) { begin(event, action); return; }
      if (current.anchor) {
        const anchor = current.anchor;
        current = null;
        action(anchor);
      } else current.activate = action;
    },
    release() {
      const request = current;
      // Pressability calls press-out before press. Wait until that activation
      // has had its turn, while still discarding drag/long-press cancellations.
      queueMicrotask(() => {
        if (current === request && !request?.activate) current = null;
      });
    },
    cancel() { current = null; },
  };
}
