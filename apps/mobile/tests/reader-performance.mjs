/** Isolated plain-text preparation cost, not rendering/FPS or native latency. */
import assert from "node:assert/strict";
import { htmlToPlainText } from "@ordo/shared";
import { performance } from "node:perf_hooks";

const html = Array.from({ length: 512 }, (_, index) =>
  `<h2>Saved idea ${index}</h2><p>Reading a <strong>durable library</strong> means keeping useful context &amp; readable references. <a href="https://example.test/${index}">Follow the source</a>.</p>`,
).join("");
// Three fonts × four sizes × two themes, all with the same original HTML.
const changes = 24;
function before() {
  let checksum = 0;
  for (let index = 0; index < changes; index++) checksum += htmlToPlainText(html).length;
  return checksum;
}
function after() {
  const articlePlain = htmlToPlainText(html);
  let checksum = 0;
  for (let index = 0; index < changes; index++) checksum += articlePlain.length;
  return checksum;
}
assert.equal(before(), after(), "Caching must retain the identical article text");
for (let index = 0; index < 5; index++) { before(); after(); }
const timings = { before: [], after: [] };
for (let index = 0; index < 30; index++) {
  // Alternate ordering so one side does not always pay for a cold iteration.
  for (const name of index % 2 ? ["before", "after"] : ["after", "before"]) {
    const start = performance.now();
    (name === "before" ? before : after)();
    timings[name].push(performance.now() - start);
  }
}
function summary(values) {
  values.sort((a, b) => a - b);
  return { medianMs: +values[Math.floor(values.length / 2)].toFixed(3), p95Ms: +values[Math.floor(values.length * 0.95)].toFixed(3) };
}
console.log(JSON.stringify({ workload: "Unchanged article across 24 appearance combinations", htmlBytes: Buffer.byteLength(html),
  iterations: 30, before: { scans: changes, ...summary(timings.before) }, after: { scans: 1, ...summary(timings.after) },
  scope: "Isolated Node plain-text preparation; does not measure React reflow, native selection or frame pacing" }, null, 2));
