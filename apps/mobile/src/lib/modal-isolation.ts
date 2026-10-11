/** Make every sibling on the path to body inert, not just visually obscured. */
export function isolateModal(root: HTMLElement): () => void {
  const previous: { node: HTMLElement; inert: boolean; hidden: string | null }[] = [];
  for (let child: HTMLElement | null = root; child?.parentElement; child = child.parentElement) {
    for (const sibling of Array.from(child.parentElement.children)) {
      if (sibling === child || !(sibling instanceof HTMLElement) || /SCRIPT|STYLE|LINK/.test(sibling.tagName)) continue;
      previous.push({ node: sibling, inert: sibling.inert, hidden: sibling.getAttribute("aria-hidden") });
      sibling.inert = true;
      sibling.setAttribute("aria-hidden", "true");
    }
    if (child.parentElement === document.body) break;
  }
  return () => {
    for (const { node, inert, hidden } of previous) {
      node.inert = inert;
      if (hidden == null) node.removeAttribute("aria-hidden");
      else node.setAttribute("aria-hidden", hidden);
    }
  };
}
