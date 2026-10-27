/**
 * Deliberately small list of dedicated advertising hosts. Bundled for offline
 * use; no broad path/DOM rules, analytics lists, remote downloads or script shims.
 * See docs/browser-ad-blocking.md before adding hosts.
 */
export const AD_HOSTS = [
  "2mdn.net",
  "adcolony.com",
  "adform.net",
  "adnxs.com",
  "adroll.com",
  "adsrvr.org",
  "advertising.com",
  "amazon-adsystem.com",
  "bidswitch.net",
  "casalemedia.com",
  "contextweb.com",
  "criteo.com",
  "criteo.net",
  "doubleclick.net",
  "googlesyndication.com",
  "googletagservices.com",
  "indexww.com",
  "lijit.com",
  "media.net",
  "moatads.com",
  "openx.net",
  "outbrain.com",
  "popads.net",
  "pubmatic.com",
  "revcontent.com",
  "rfihub.com",
  "rubiconproject.com",
  "sharethrough.com",
  "smartadserver.com",
  "taboola.com",
  "teads.tv",
  "yieldmo.com",
] as const;

/** Exact website host, without a port. Do not strip www or broaden exceptions. */
export function adBlockSiteHost(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.hostname.toLowerCase().replace(/\.+$/, "") || null;
  } catch {
    return null;
  }
}

export function normalizeAdBlockAllowedHosts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap((host: unknown) => {
    if (typeof host !== "string" || host.length > 253) return [];
    const normalized = host.toLowerCase().replace(/\.+$/, "");
    const dnsHost = /^[a-z0-9.-]+$/.test(normalized);
    const ipv6Host = /^\[[0-9a-f:]+\]$/.test(normalized);
    if ((!dnsHost && !ipv6Host) || normalized.startsWith(".") || normalized.includes("..")) return [];
    const canonical = adBlockSiteHost(`https://${normalized}/`);
    return canonical ? [canonical] : [];
  }))];
}

/** Controls accepts a hostname or pasted HTTP(S) URL, and saves only its host. */
export function adBlockExceptionHost(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  if (value.includes("://") && !/^https?:\/\//i.test(value)) return null;
  try {
    const parsed = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.username || parsed.password) return null;
    return normalizeAdBlockAllowedHosts([parsed.hostname])[0] ?? null;
  } catch {
    return null;
  }
}

/** Stop ad navigations without blocking ordinary redirects or direct visits. */
export function shouldBlockAdNavigation(url: string, pageUrl: string, enabled: boolean, allowedHosts: readonly string[]): boolean {
  if (!enabled) return false;
  const page = adBlockSiteHost(pageUrl);
  const target = adBlockSiteHost(url);
  if (!page || !target || normalizeAdBlockAllowedHosts(allowedHosts).includes(page)) return false;
  return AD_HOSTS.some((host) => (target === host || target.endsWith(`.${host}`))
    && page !== host && !page.endsWith(`.${host}`));
}

/** MangaFire places an invisible ad link above the page. Scope this cosmetic
 * rule to its reported popup overlay; regular links and popup APIs stay native.
 * See uBlockOrigin/uAssets#33585 and docs/browser-ad-blocking.md. */
export function browserAdBlockingPageScript(enabled: boolean, allowedHosts: readonly string[]): string {
  return `(function(){
    var host = window.location.hostname.toLowerCase().replace(/\\.+$/, '');
    var active = ${enabled} && (host === 'mangafire.to' || host === 'www.mangafire.to')
      && ${JSON.stringify(normalizeAdBlockAllowedHosts(allowedHosts))}.indexOf(host) < 0;
    var id = '__ordo_ad_popup_overlay_rule';
    var style = document.getElementById(id);
    if (!active) { if (style) style.remove(); return; }
    if (style) return;
    var root = document.head || document.documentElement;
    if (!root) return;
    style = document.createElement('style');
    style.id = id;
    style.textContent = 'a[href][target="_blank"][style*="z-index: 99999" i], a[href][target="_blank"][style*="z-index:99999" i] { display: none !important; }';
    root.appendChild(style);
  })(); true;`;
}

function escapeRuleHost(host: string): string {
  return host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** WebKit regexes anchor the authority, including optional credentials/ports. */
function hostUrlPattern(host: string, includeSubdomains: boolean): string {
  return `^https?://([^/]*@)?${includeSubdomains ? "([^/:]+\\.)*" : ""}${escapeRuleHost(host)}\\.?(:[0-9]+)?[/?#]`;
}

/** Shared native config; an empty string removes all Ordo content rules. */
export function browserAdBlockingRules(enabled: boolean, allowedHosts: readonly string[]): string {
  if (!enabled) return "";
  const allowed = normalizeAdBlockAllowedHosts(allowedHosts);
  // Content rules exclude documents so forms, downloads and frames retain
  // native behavior. A separate navigation policy stops known ad redirects.
  const webKitRules = AD_HOSTS.map((host) => ({
    trigger: {
      "url-filter": hostUrlPattern(host, true),
      "load-type": ["third-party"],
      "resource-type": ["image", "style-sheet", "script", "font", "raw", "svg-document", "media"],
      "unless-top-url": [hostUrlPattern(host, true), ...allowed.map((site) => hostUrlPattern(site, false))],
    },
    action: { type: "block" },
  }));
  return JSON.stringify({ blockedHosts: AD_HOSTS, allowedHosts: allowed, webKitRules: JSON.stringify(webKitRules) });
}
