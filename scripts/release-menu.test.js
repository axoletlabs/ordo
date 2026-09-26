"use strict";

const assert = require("node:assert/strict");
const { PassThrough } = require("node:stream");
const test = require("node:test");
const {
  filterReleaseRows,
  hiddenPreCount,
  promptReleaseMenu,
  reduceReleaseMenu,
  releaseMenuRows,
  renderReleaseMenu,
} = require("./release-menu.js");

function release(tag, { pre = false, date = "2026-09-01" } = {}) {
  return {
    tag_name: tag,
    prerelease: pre,
    draft: false,
    published_at: `${date}T00:00:00Z`,
  };
}

const catalog = [
  release("v0.2.0", { date: "2026-09-20" }),
  release("v0.2.0-rc.1", { pre: true, date: "2026-09-18" }),
  release("v0.1.1", { date: "2026-08-02" }),
  release("v0.1.0", { date: "2026-07-01" }),
];

test("release rows mark the newest stable and hide pre-releases", () => {
  const rows = releaseMenuRows(catalog, { installedTag: "v0.1.0" });
  assert.deepEqual(
    rows.map((row) => row.tag),
    ["v0.2.0", "v0.1.1", "v0.1.0"],
  );
  assert.deepEqual(rows[0].marks, ["latest"]);
  assert.deepEqual(rows[2].marks, ["installed"]);
  assert.equal(hiddenPreCount(catalog), 1);
  assert.equal(hiddenPreCount(catalog, { pre: true }), 0);
});

test("typing filters by version and arrows wrap", () => {
  const rows = releaseMenuRows(catalog);
  assert.deepEqual(
    filterReleaseRows(rows, "0.1").map((row) => row.tag),
    ["v0.1.1", "v0.1.0"],
  );
  assert.deepEqual(filterReleaseRows(rows, "v0.2.0").map((row) => row.tag), ["v0.2.0"]);

  let state = { query: "", selected: 0 };
  state = reduceReleaseMenu(state, { name: "down" }, rows);
  assert.equal(state.selected, 1);
  state = reduceReleaseMenu(state, { name: "up" }, rows);
  assert.equal(state.selected, 0);
  state = reduceReleaseMenu(state, { name: "up" }, rows);
  assert.equal(state.selected, rows.length - 1);
  state = reduceReleaseMenu(state, { name: "v", sequence: "0" }, rows);
  assert.equal(state.query, "0");
  assert.equal(state.selected, 0);
  state = reduceReleaseMenu(state, { name: "backspace", sequence: "\u007f" }, rows);
  assert.equal(state.query, "");
  state = reduceReleaseMenu({ query: "0.1", selected: 1 }, { name: "escape" }, rows);
  assert.equal(state.query, "");
  assert.equal(state.selected, 0);
  assert.equal(reduceReleaseMenu(state, { name: "c", ctrl: true, sequence: "\u0003" }, rows).action, "cancel");
});

test("the menu renders a highlight, a version line, and the hidden count", () => {
  const rows = releaseMenuRows(catalog, { installedTag: "v0.1.0" });
  const plain = renderReleaseMenu(
    { rows, query: "0.1", selected: 1 },
    { color: false, hiddenPre: 1 },
  );
  assert.match(plain, /Choose a release/);
  assert.match(plain, /› v0\.1\.1/);
  assert.match(plain, /v0\.1\.0\s+stable/);
  assert.match(plain, /version {2}0\.1/);
  assert.match(plain, /1 pre-release hidden/);
  assert.doesNotMatch(plain, /\u001b\[/);

  const colored = renderReleaseMenu({ rows, query: "", selected: 0 }, { color: true, hiddenPre: 0 });
  assert.match(colored, /\u001b\[36m›/);
  assert.match(colored, /\u001b\[1mv0\.2\.0/);
});

function keyStreams() {
  const input = new PassThrough();
  input.isTTY = true;
  input.isRaw = false;
  input.setRawMode = () => {};
  const output = new PassThrough();
  output.isTTY = true;
  return { input, output };
}

test("arrow keys move the highlight and enter selects it", async () => {
  const rows = releaseMenuRows(catalog);
  const { input, output } = keyStreams();
  const pending = promptReleaseMenu({ rows, input, output, color: false, hiddenPre: 1 });
  setImmediate(() => {
    input.write("\u001b[B");
    input.write("\r");
  });
  const chosen = await pending;
  assert.equal(chosen.tag_name, "v0.1.1");
  const drawn = output.read().toString("utf8");
  assert.match(drawn, /Choose a release/);
  assert.match(drawn, /1 pre-release hidden/);
});

test("a typed version selects that tag, and an unknown tag asks to be fetched", async () => {
  const rows = releaseMenuRows(catalog);
  const typed = keyStreams();
  const typedPick = promptReleaseMenu({ rows, input: typed.input, output: typed.output, color: false });
  setImmediate(() => {
    typed.input.write("v0.1.0");
    typed.input.write("\r");
  });
  assert.equal((await typedPick).tag_name, "v0.1.0");

  const missing = keyStreams();
  const missingPick = promptReleaseMenu({
    rows,
    input: missing.input,
    output: missing.output,
    color: false,
  });
  setImmediate(() => {
    missing.input.write("v9.9.9");
    missing.input.write("\r");
  });
  await assert.rejects(missingPick, (error) => error.fetchTag === "v9.9.9");
});
