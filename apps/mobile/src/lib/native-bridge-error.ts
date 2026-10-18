/**
 * Expo/Android native errors that should not be shown as toast copy.
 */
export function looksLikeNativeBridgeError(message: string): boolean {
  return (
    /Call to function /i.test(message) ||
    /isn't (writable|readable|deletable)/i.test(message) ||
    /\bjava\.(io|lang)\./i.test(message)
  );
}
