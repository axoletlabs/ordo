/**
 * Expo/Android native errors that should not be shown as toast copy.
 * Keep this file free of react-native so node tests can import it.
 */
export function looksLikeNativeBridgeError(message: string): boolean {
  return (
    /Call to function /i.test(message) ||
    /isn't (writable|readable|deletable)/i.test(message) ||
    /\bjava\.(io|lang)\./i.test(message)
  );
}
