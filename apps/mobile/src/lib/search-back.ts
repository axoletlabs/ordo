/** An active search consumes Back without changing its query or navigation. */
export function handleSearchBack(active: boolean, exit: () => void): boolean {
  if (!active) return false;
  exit();
  return true;
}

/** Android's IME can consume Back before React Native receives it. */
export function exitSearchAfterKeyboardHide(active: boolean, overlayActive: boolean): boolean {
  return active && !overlayActive;
}
