"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { terminalLines, wrap } = require("./terminal-ui.js");
const { renderChoiceMenu } = require("./choice-menu.js");
const { renderReleaseMenu, releaseMenuRows } = require("./release-menu.js");

test("redraw counts wrapped physical rows rather than just newlines", () => {
  assert.equal(terminalLines("\x1b[1m12345678901\x1b[0m\n\nend\n", 10), 4);
  assert.equal(terminalLines("1234567890\n", 10), 1);
  assert.equal(terminalLines("one\ntwo\n", 80), 2);
});

test("descriptions wrap with consistent indentation on a narrow terminal", () => {
  const text = wrap("The first sign-up becomes the owner either way.", 30);
  assert.ok(text.split("\n").every((line) => line.length < 30 && line.startsWith("  ")));
  const menu = renderChoiceMenu({
    title: "Who can create an account?",
    detail: "The first sign-up becomes the owner either way.",
    options: [{ label: "Only the first account" }], selected: 0,
  }, { columns: 30 });
  assert.match(menu, /  The first sign-up becomes\n  the owner either way\./);
});

test("release list scrolls around the selection without overflowing short terminals", () => {
  const rows = releaseMenuRows(Array.from({ length: 25 }, (_, n) => ({ tag_name: `v0.1.${n}` })));
  const menu = renderReleaseMenu({ rows, selected: 20, query: "" }, { maxRows: 4 });
  assert.equal((menu.match(/v0\.1\./g) || []).length, 4);
  assert.match(menu, new RegExp(`› ${rows[20].tag.replaceAll(".", "\\.")}`));
  assert.match(menu, /21 of 25/);
  assert.doesNotMatch(menu, /  version/);
});
