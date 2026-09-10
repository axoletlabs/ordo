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
