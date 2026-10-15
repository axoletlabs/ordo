/** Split only neutral containers: paragraphs, lists, tables and quotes stay intact. */
import { parseDocument } from "htmlparser2";
import { Document, Element, cloneNode, isTag, type ChildNode } from "domhandler";

const CONTAINERS = new Set(["div", "article", "section", "main", "body", "html"]);
export const ARTICLE_SECTION_BLOCKS = 64;
// Count text, not markup: adding a saved <mark> must not move every later
// section boundary and invalidate all of their native trees.
const SECTION_CHARACTERS = 24_000;

export interface SectionHeading { id: string; level: 1 | 2 | 3; text: string }

function textContent(node: ChildNode): string {
  if (node.type === "text") return node.data;
  if (isTag(node) && node.name === "br") return "\n";
  return "children" in node ? node.children.map(textContent).join("") : "";
}

function attach<T extends Document | Element>(parent: T, children: ChildNode[]): T {
  parent.children = children;
  children.forEach((child, index) => {
    child.parent = parent;
    child.prev = children[index - 1] ?? null;
    child.next = children[index + 1] ?? null;
  });
  return parent;
}

function* sectionChildren(children: ChildNode[]): Generator<ChildNode[]> {
  let group: ChildNode[] = [];
  let characters = 0;
  for (const child of children) {
    // Styling a container can give it padding, borders or a background. Never
    // duplicate those decorations at section boundaries.
    const neutral = isTag(child) && CONTAINERS.has(child.name) && !child.attribs.style;
    if (neutral) {
      if (group.length) { yield group; group = []; characters = 0; }
      for (const section of sectionChildren(child.children)) {
        yield [attach(cloneNode(child, false), section)];
      }
      continue;
    }
    group.push(child);
    characters += textContent(child).length;
    if (group.length >= ARTICLE_SECTION_BLOCKS || characters >= SECTION_CHARACTERS) {
      yield group;
      group = [];
      characters = 0;
    }
  }
  if (group.length) yield group;
}

/** One cheap DOM parse; expensive styled/native trees are built section by section. */
export function prepareArticleSections(html: string) {
  const document = parseDocument(html);
  const headings: SectionHeading[] = [];
  const ids = new Set<string>();
  const visitIds = (nodes: ChildNode[]) => {
    for (const node of nodes) if (isTag(node)) {
      if (node.attribs.id) ids.add(node.attribs.id);
      visitIds(node.children);
    }
  };
  visitIds(document.children);
  let sequence = 0;
  const visitHeadings = (nodes: ChildNode[]) => {
    for (const node of nodes) if (isTag(node)) {
      if (/^h[1-3]$/.test(node.name)) {
        if (!node.attribs.id) {
          let id: string;
          do { id = `ordo-heading-${sequence++}`; } while (ids.has(id));
          node.attribs.id = id;
          ids.add(id);
        }
        const text = textContent(node).replace(/\s+/g, " ").trim();
        if (text) headings.push({ id: node.attribs.id, level: Number(node.name[1]) as 1 | 2 | 3, text });
      }
      visitHeadings(node.children);
    }
  };
  visitHeadings(document.children);
  const sections = [...sectionChildren(document.children)].map(children => ({ dom: attach(new Document([]), children) }));
  return { sections, headings };
}

function sameNodes(left: ChildNode[], right: ChildNode[]): boolean {
  return left.length === right.length && left.every((node, index) => {
    const other = right[index]!;
    if (node.type !== other.type) return false;
    if (node.type === "text" && other.type === "text") return node.data === other.data;
    if (isTag(node) && isTag(other)) {
      if (node.name !== other.name) return false;
      const keys = Object.keys(node.attribs);
      if (keys.length !== Object.keys(other.attribs).length || keys.some(key => node.attribs[key] !== other.attribs[key])) return false;
      return sameNodes(node.children, other.children);
    }
    if ("data" in node && "data" in other) return node.data === other.data;
    return false;
  });
}

/** A highlight edit must not reparse/remount every unaffected native section. */
export function reuseArticleSections(
  previous: Array<{ dom: Document }>, next: Array<{ dom: Document }>,
): Array<{ dom: Document }> {
  return next.map((section, index) => previous[index] && sameNodes(previous[index]!.dom.children, section.dom.children)
    ? previous[index]! : section);
}
