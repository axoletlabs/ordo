/**
 * Lets the search tab / rail focus the field without threading a ref through
 * the tab navigator.
 */
let focusSearchField: (() => void) | null = null;

export function registerSearchFieldFocus(focus: (() => void) | null) {
  focusSearchField = focus;
}

export function requestSearchFieldFocus() {
  focusSearchField?.();
}
