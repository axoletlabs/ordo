/** Nested chips/actions own pointer feedback; don't also light the whole row. */
export function rowOwnsHover(event: { target?: unknown; currentTarget?: unknown }) {
  const surface = (event.target as { closest?: (selector: string) => unknown } | null)?.closest?.("[data-material-hover-surface]");
  return !surface || surface === event.currentTarget;
}
