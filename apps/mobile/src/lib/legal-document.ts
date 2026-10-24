import { CLOUD_WEBSITE_URL } from "./hosting";
import type { Palette } from "../theme/theme";
import { layout, radius, spacing } from "../theme/tokens";

export const LEGAL_DOCUMENTS = [
  { id: "terms", title: "Terms of service" },
  { id: "privacy", title: "Privacy policy" },
  { id: "security", title: "Security" },
] as const;
export type LegalDocument = typeof LEGAL_DOCUMENTS[number];

export function legalDocumentForUrl(url: string): LegalDocument | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.origin !== CLOUD_WEBSITE_URL) return undefined;
    return LEGAL_DOCUMENTS.find((doc) => parsed.pathname.replace(/\/$/, "") === `/${doc.id}`);
  } catch { return undefined; }
}

/** Keep the published policy intact, replacing only the website presentation. */
export function legalDocumentStyle(p: Palette): string {
  return `
html:has(body.legal-page){scroll-behavior:auto!important}
body.legal-page{margin:0!important;background:${p.background}!important;color:${p.onSurface}!important;
  font:400 16px/24px Roboto,"Roboto Flex",system-ui,sans-serif!important;letter-spacing:.5px!important}
body.legal-page *,body.legal-page *::before,body.legal-page *::after{box-sizing:border-box;animation:none!important;transition:none!important}
body.legal-page>header,body.legal-page>footer,body.legal-page .legal-nav,
body.legal-page .legal-toc,body.legal-page .legal-jump{display:none!important}
body.legal-page .legal-main,body.legal-page .legal-details{display:block!important;margin:0!important;padding:0!important;width:100%!important;max-width:none!important}
body.legal-page article.legal{display:block!important;width:100%!important;max-width:${layout.maxReaderWidth}px!important;
  margin:0 auto!important;padding:${spacing[16]}px ${spacing[16]}px ${spacing[48]}px!important}
body.legal-page h1{position:absolute!important;width:1px!important;height:1px!important;overflow:hidden!important;clip-path:inset(50%);margin:0!important}
body.legal-page :is(p,li,dd,dt){font:inherit!important;color:inherit!important;max-width:none!important}
body.legal-page p{margin:${spacing[16]}px 0!important}
body.legal-page .legal-lede{margin-top:0!important}
body.legal-page .legal-updated,body.legal-page .legal-identity{color:${p.onSurfaceVariant}!important;font-size:14px!important;line-height:20px!important}
body.legal-page :is(h2,h3){font-family:inherit!important;font-style:normal!important;font-weight:500!important;color:${p.onSurface}!important;letter-spacing:0!important}
body.legal-page h2{font-size:22px!important;line-height:28px!important;margin:0 0 ${spacing[16]}px!important}
body.legal-page h3{font-size:16px!important;line-height:24px!important}
body.legal-page section{margin:${spacing[32]}px 0 0!important;padding:0!important;border:0!important}
body.legal-page .legal-num{color:inherit!important;font:inherit!important}
body.legal-page .legal-note{display:block!important;background:${p.surfaceContainerLow}!important;color:${p.onSurface}!important;
  border:0!important;border-radius:${radius.lg}px!important;margin:${spacing[24]}px 0!important;padding:${spacing[16]}px!important}
body.legal-page .legal-note p:last-child{margin-bottom:0!important}
body.legal-page .legal-note strong{font:500 16px/24px Roboto,"Roboto Flex",system-ui,sans-serif!important}
body.legal-page a{color:${p.primary}!important;text-decoration:underline!important;text-underline-offset:3px}
body.legal-page a:focus-visible{outline:2px solid ${p.primary};outline-offset:3px}
body.legal-page code{color:inherit!important;background:${p.surfaceContainerHigh}!important;overflow-wrap:anywhere}
body.legal-page :is(ul,ol){padding-left:${spacing[24]}px!important}
body.legal-page li{margin:${spacing[8]}px 0!important}
body.legal-page table{display:block;max-width:100%;overflow-x:auto}
`;
}

/** Web uses a sandboxed document because cross-origin iframes cannot be restyled. */
export function legalDocumentHtml(html: string, url: string, css: string): string {
  const bridge = `<script>
document.addEventListener('click',function(e){
  var a=e.target.closest&&e.target.closest('a');
  if(!a||!e.isTrusted||e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
  var u=new URL(a.getAttribute('href'),document.baseURI);
  if(u.origin===${JSON.stringify(CLOUD_WEBSITE_URL)}&&/^\\/(terms|privacy|security)\\/?$/.test(u.pathname)){
    if(u.href.split('#')[0]===${JSON.stringify(url)}&&u.hash){
      e.preventDefault();
      var target=document.getElementById(decodeURIComponent(u.hash.slice(1)));
      if(target)target.scrollIntoView();
      return;
    }
    e.preventDefault();parent.postMessage({type:'ordo-legal-document',url:u.href},'*');
  }else{a.target='_blank';a.rel='noopener noreferrer';}
},true);
</script>`;
  return html.replace(/<head\b[^>]*>/i, (head) => `${head}<base href="${url}"><style>${css}</style>`)
    .replace(/<\/body>/i, `${bridge}</body>`);
}
