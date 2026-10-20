/** Make every sibling on the path to body inert, not just visually obscured. */
type NodeLock = { count: number; inert: boolean; hidden: string | null };
type LockState = {
  scroll: { count: number; html: string; body: string };
  nodes: Map<HTMLElement, NodeLock>;
};
const states = new WeakMap<Document, LockState>();

function lockState(): LockState {
  let state = states.get(document);
  if (!state) {
    state = { scroll: { count: 0, html: document.documentElement.style.overflow, body: document.body.style.overflow },
      nodes: new Map() };
    states.set(document, state);
  }
  return state;
}

export function isolateModal(root: HTMLElement): () => void {
  const state = lockState();
  const scrollRoots = [document.documentElement, document.body];
  if (state.scroll.count === 0) {
    state.scroll.html = scrollRoots[0].style.overflow;
    state.scroll.body = scrollRoots[1].style.overflow;
    scrollRoots.forEach((node) => { node.style.overflow = "hidden"; });
  }
  state.scroll.count += 1;

  const locked: HTMLElement[] = [];
  for (let child: HTMLElement | null = root; child?.parentElement; child = child.parentElement) {
    for (const sibling of Array.from(child.parentElement.children)) {
      if (sibling === child || !(sibling instanceof HTMLElement) || /SCRIPT|STYLE|LINK/.test(sibling.tagName)) continue;
      const lock = state.nodes.get(sibling);
      if (!lock) {
        state.nodes.set(sibling, { count: 1, inert: sibling.inert, hidden: sibling.getAttribute("aria-hidden") });
        sibling.inert = true;
        sibling.setAttribute("aria-hidden", "true");
      } else {
        lock.count += 1;
      }
      locked.push(sibling);
    }
    if (child.parentElement === document.body) break;
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.scroll.count -= 1;
    if (state.scroll.count === 0) {
      scrollRoots[0].style.overflow = state.scroll.html;
      scrollRoots[1].style.overflow = state.scroll.body;
    }
    for (const node of locked) {
      const lock = state.nodes.get(node);
      if (!lock) continue;
      lock.count -= 1;
      if (lock.count > 0) continue;
      node.inert = lock.inert;
      if (lock.hidden == null) node.removeAttribute("aria-hidden");
      else node.setAttribute("aria-hidden", lock.hidden);
      state.nodes.delete(node);
    }
  };
}
