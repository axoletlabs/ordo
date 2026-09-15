/**
 * Walk a render-html TNode (or a test double) and pull out table rows.
 * Nested thead/tbody/tr wrappers are flattened so the reader can render a
 * cheap stacked layout instead of Yoga-flex table cells.
 */
export interface HtmlTableNode {
  type: string;
  tagName?: string | null;
  data?: string;
  children?: readonly HtmlTableNode[];
}

export function collectTableRows(node: HtmlTableNode): HtmlTableNode[][] {
  const rows: HtmlTableNode[][] = [];
  const walk = (current: HtmlTableNode) => {
    if (current.type === "text") return;
    if (current.tagName === "tr") {
      const cells = (current.children ?? []).filter(
        (child) => child.tagName === "td" || child.tagName === "th",
      );
      if (cells.length) rows.push(cells);
      return;
    }
    (current.children ?? []).forEach(walk);
  };
  walk(node);
  return rows;
}

export function splitTableHeader(rows: HtmlTableNode[][]): {
  header: HtmlTableNode[] | null;
  body: HtmlTableNode[][];
} {
  if (rows.length === 0) return { header: null, body: [] };
  const first = rows[0];
  const isHeader = first.length > 0 && first.every((cell) => cell.tagName === "th");
  if (isHeader) return { header: first, body: rows.slice(1) };
  return { header: null, body: rows };
}

export function plainTextFromNode(node: HtmlTableNode): string {
  const walk = (current: HtmlTableNode): string => {
    if (current.type === "text") return current.data ?? "";
    if (current.tagName === "br") return "\n";
    return (current.children ?? []).map(walk).join("");
  };
  return walk(node).replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

/** Concatenate descendant text without trimming — matches native Text layout. */
export function nodeTextContent(node: HtmlTableNode): string {
  const walk = (current: HtmlTableNode): string => {
    if (current.type === "text") return current.data ?? "";
    if (current.tagName === "br") return "\n";
    return (current.children ?? []).map(walk).join("");
  };
  return walk(node);
}

export interface TextLayoutLine {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Map a press inside a laid-out Text block onto a character index. */
export function offsetFromLayout(lines: readonly TextLayoutLine[], x: number, y: number): number {
  if (lines.length === 0) return 0;
  let offset = 0;
  let chosen = lines[0]!;
  let chosenOffset = 0;
  for (const line of lines) {
    const lineStart = offset;
    if (y >= line.y && y <= line.y + line.height) {
      chosen = line;
      chosenOffset = lineStart;
      break;
    }
    if (y > line.y) {
      chosen = line;
      chosenOffset = lineStart;
    }
    offset += line.text.length;
  }
  if (chosen.width <= 0) return chosenOffset;
  const ratio = Math.min(1, Math.max(0, (x - chosen.x) / chosen.width));
  const col = Math.min(chosen.text.length, Math.round(ratio * chosen.text.length));
  return chosenOffset + col;
}
