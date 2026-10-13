/** Known authenticated routes can dispatch directly without Expo's effect queue. */
export function appDestination(href: string | { pathname: string; params?: Record<string, unknown> }) {
  const pathname = typeof href === "string" ? href.split("?")[0] : href.pathname;
  const params: Record<string, unknown> = typeof href === "string"
    ? Object.fromEntries(new URLSearchParams(href.split("?")[1] ?? "")) : { ...href.params };
  const path = pathname.replace(/^\/\(app\)/, "").replace(/^\/|\/$/g, "");
  if (path === "settings" || path === "tags") return { name: `${path}/index`, params };
  if (/^settings\/[a-z-]+$/.test(path)) return { name: path, params };
  const match = /^(folder|reader|tags)\/([^/]+)$/.exec(path);
  if (!match) return null;
  if (match[2] !== "[id]") {
    try { params.id = decodeURIComponent(match[2]); } catch { return null; }
  }
  return { name: `${match[1]}/[id]`, params };
}

/** One handoff per focused source. Reset on return, never debounce the first tap. */
export function createNavigationFlight() {
  let pending: string | null = null;
  return {
    begin(source: string, focused: boolean) {
      if (!focused || pending === source) return false;
      pending = source;
      return true;
    },
    release(source: string) { if (pending === source) pending = null; },
  };
}
