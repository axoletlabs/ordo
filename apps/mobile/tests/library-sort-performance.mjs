/** Identical ordering; isolated Node CPU, not native frame timing. */
import assert from "node:assert/strict";
import { sortBookmarksBy } from "../src/lib/list-sort.ts";

const items = Array.from({ length: 10000 }, (_, index) => ({ id: String(index),
  title: `${["Éclair", "design", "Design", "A quieter reader", "中文", "Ångström"][index % 6]} ${index * 7919 % 10000}` }));
const before = () => [...items].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id));
const after = () => sortBookmarksBy(items, "title");
assert.deepEqual(after(), before());
const samples = { before: [], after: [] };
for (let run = 0; run < 12; run++) {
  for (const name of run % 2 ? ["before", "after"] : ["after", "before"]) {
    const start = performance.now();
    (name === "before" ? before : after)();
    if (run > 1) samples[name].push(performance.now() - start);
  }
}
const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
console.log(JSON.stringify({ workload: "10,000 mixed-case/Unicode titles", iterations: 10,
  beforeMs: median(samples.before), afterMs: median(samples.after), scope: "Node sort only; identical item order" }, null, 2));
