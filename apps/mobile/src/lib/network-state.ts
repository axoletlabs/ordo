/**
 * Device-link connectivity for a self-hosted app.
 *
 * `isInternetReachable` is a public-internet probe (often a ping to Google).
 * It is false on LAN/VPN-only networks and `null` while unknown — neither
 * means the configured Ordo server is down, so it must not freeze the UI.
 * A missing device link (`isConnected === false`) does freeze the app: there
 * is no offline mode yet.
 */
export function networkStateIsOnline(state: {
  isConnected?: boolean | null;
  isInternetReachable?: boolean | null;
}): boolean {
  return state.isConnected !== false;
}
