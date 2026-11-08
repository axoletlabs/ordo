import React from "react";

export interface DraftDismissScope {
  edit: (id: string, initial: string, value: string) => void;
  sync: (id: string, value: string) => void;
  request: (action: () => void) => boolean;
}
export const DraftDismissContext = React.createContext<DraftDismissScope | null>(null);

/** For a form's Back/Cancel action that isn't part of PanelActions. */
export function DraftDismissAction({ children }: { children: React.ReactElement<{ onPress?: () => unknown }> }) {
  const scope = React.useContext(DraftDismissContext);
  return React.cloneElement(children, { onPress: () => {
    const action = () => { children.props.onPress?.(); };
    if (scope) scope.request(action); else action();
  } });
}

/** Only user edits establish a baseline; opening resets and sibling pickers
 * never replace it. Values live in memory for this panel session only. */
export function useDraftDismiss(visible: boolean, dirty = false) {
  const fields = React.useRef(new Map<string, { initial: string; value: string }>());
  const explicitDirty = React.useRef(dirty);
  explicitDirty.current = dirty;
  const pending = React.useRef<(() => void) | null>(null);
  const [confirming, setConfirming] = React.useState(false);
  const [used, setUsed] = React.useState(false);
  React.useLayoutEffect(() => {
    if (visible) return;
    fields.current.clear();
    pending.current = null;
    setConfirming(false);
  }, [visible]);
  const scope = React.useMemo<DraftDismissScope>(() => ({
    edit(id, initial, value) {
      fields.current.set(id, { initial: fields.current.get(id)?.initial ?? initial, value });
    },
    sync(id, value) {
      const field = fields.current.get(id);
      if (field) field.value = value;
    },
    request(action) {
      if (explicitDirty.current || [...fields.current.values()].some(f => f.initial !== f.value)) {
        pending.current = action;
        setUsed(true);
        setConfirming(true);
        return false;
      }
      action();
      return true;
    },
  }), []);
  const keep = () => { pending.current = null; setConfirming(false); };
  const discard = () => {
    const action = pending.current;
    pending.current = null;
    fields.current.clear();
    setConfirming(false);
    action?.();
  };
  return { scope, confirming, used, keep, discard };
}

/** Shared by text, code, color, clock and pattern input surfaces. */
export function usePanelDraftField(value: string) {
  const scope = React.useContext(DraftDismissContext);
  const id = React.useId();
  React.useEffect(() => { scope?.sync(id, value); }, [scope, id, value]);
  return React.useCallback((next: string) => scope?.edit(id, value, next), [scope, id, value]);
}
