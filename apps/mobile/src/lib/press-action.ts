/** Feedback describes a committed action, never a rejected navigation intent. */
export function runPressAction<T>(action: () => T, feedback: () => void): T {
  const result = action();
  if (result !== false) feedback();
  return result;
}
