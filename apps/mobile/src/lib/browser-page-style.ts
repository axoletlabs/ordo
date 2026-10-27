/** Install app-owned document styles at document start and after navigation. */
export function browserPageStyleScript(css: string): string {
  return `(function(){
    var s=document.getElementById('ordo-document-style')||document.createElement('style');
    s.id='ordo-document-style';
    s.textContent=${JSON.stringify(css)};
    (document.head||document.documentElement).appendChild(s);
  })();true;`;
}
