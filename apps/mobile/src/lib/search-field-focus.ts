/**
 * Lets the search tab / rail focus the field without threading a ref through
 * the tab navigator.
 *
 * The handler is only registered while Search is focused. Calling `focus()` on
 * a frozen off-screen TextInput (freezeOnBlur) leaves the native view stuck,
 * so later retaps look like they do nothing.
 */
let focusSearchField: (() => void) | null = null;
let pendingUntil = 0;
let retryFrame = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

/** Tab-press handling can blur the field after a sync focus(); retry shortly. */
const FOCUS_RETRY_MS = 50;
/** Cover the gap between "search is focused" and the field's focus effect. */
const PENDING_FOCUS_MS = 250;

function clearScheduledFocus() {
  if (retryFrame && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(retryFrame);
    retryFrame = 0;
  }
  if (retryTimer != null) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function runFocus() {
  focusSearchField?.();
}

function scheduleFocusRetries() {
  clearScheduledFocus();
  if (typeof requestAnimationFrame === "function") {
    retryFrame = requestAnimationFrame(() => {
      retryFrame = 0;
      runFocus();
    });
  }
  retryTimer = setTimeout(() => {
    retryTimer = null;
    runFocus();
  }, FOCUS_RETRY_MS);
}

export function registerSearchFieldFocus(focus: () => void) {
  focusSearchField = focus;
  if (Date.now() < pendingUntil) {
    pendingUntil = 0;
    runFocus();
    scheduleFocusRetries();
  }
  return () => {
    if (focusSearchField === focus) {
      focusSearchField = null;
      pendingUntil = 0;
      clearScheduledFocus();
    }
  };
}

export function requestSearchFieldFocus() {
  if (!focusSearchField) {
    pendingUntil = Date.now() + PENDING_FOCUS_MS;
    return;
  }
  runFocus();
  scheduleFocusRetries();
}
