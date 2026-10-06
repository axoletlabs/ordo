"use strict";

const assert = require("node:assert/strict");
const { PassThrough } = require("node:stream");
const test = require("node:test");
const { promptChoiceMenu, promptYesNo, reduceChoiceMenu, renderChoiceMenu } = require("./choice-menu.js");

const options = [
  { label: "Install pnpm 11.10.0", value: "install" },
  { label: "I'll install it myself", value: "manual" },
];

test("arrows wrap and other keys do nothing", () => {
  let state = { selected: 0 };
  state = reduceChoiceMenu(state, { name: "down" }, 2);
  assert.equal(state.selected, 1);
  assert.equal(state.action, "redraw");
  state = reduceChoiceMenu(state, { name: "down", sequence: "\u001b[B" }, 2);
  assert.equal(state.selected, 0);
  state = reduceChoiceMenu(state, { name: "up", sequence: "\u001b[A" }, 2);
  assert.equal(state.selected, 1);
  assert.equal(reduceChoiceMenu(state, { name: "y", sequence: "y" }, 2).action, "ignore");
  assert.equal(reduceChoiceMenu(state, { name: "return" }, 2).action, "submit");
  assert.equal(reduceChoiceMenu(state, { name: "c", ctrl: true, sequence: "\u0003" }, 2).action, "cancel");
  assert.equal(reduceChoiceMenu(state, { name: "escape", sequence: "\u001b" }, 2).action, "cancel");
  assert.equal(reduceChoiceMenu(state, { sequence: "\u001b" }, 2).action, "cancel");
});

test("the highlight is the only marker", () => {
  const plain = renderChoiceMenu(
    { title: "pnpm is not installed.", options, selected: 0 },
    { color: false },
  );
  assert.match(plain, /pnpm is not installed\./);
  assert.match(plain, /› Install pnpm 11\.10\.0/);
  assert.match(plain, / {2}I'll install it myself/);
  assert.doesNotMatch(plain, /› I'll install it myself/);
  assert.match(plain, /↑↓ move {4}enter select {4}esc cancel/);
  assert.doesNotMatch(plain, /\u001b\[/);

  const colored = renderChoiceMenu(
    { title: "Allow new sign-ups after the first account?", options: [{ label: "Yes" }, { label: "No" }], selected: 1 },
    { color: true },
  );
  assert.match(colored, /\u001b\[36m›/);
  assert.match(colored, /\u001b\[1mNo/);

  const explained = renderChoiceMenu(
    {
      title: "Who can create an account?",
      detail: "The first sign-up becomes the owner either way.",
      options: [{ label: "Only the first account" }, { label: "Anyone who can reach the server" }],
      selected: 0,
    },
    { color: false },
  );
  assert.match(explained, /The first sign-up becomes the owner either way\./);
  assert.match(explained, /› Only the first account/);
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

test("enter selects the highlighted row", async () => {
  const { input, output } = keyStreams();
  const pending = promptChoiceMenu({ title: "Pick", options, selected: 0, input, output, color: false });
  setImmediate(() => {
    input.write("\u001b[B");
    input.write("\r");
  });
  assert.equal(await pending, "manual");
  const drawn = output.read().toString("utf8");
  assert.match(drawn, /› I'll install it myself/);
});

test("escape cancels the menu", async () => {
  const { input, output } = keyStreams();
  const pending = promptChoiceMenu({ title: "Pick", options, selected: 0, input, output, color: false });
  setImmediate(() => input.write("\u001b"));
  await assert.rejects(() => pending, (error) => error.code === "CANCELLED");
});

test("yes and no start on the default", async () => {
  const no = keyStreams();
  const pendingNo = promptYesNo("Allow new sign-ups after the first account?", false, {
    input: no.input,
    output: no.output,
    color: false,
  });
  setImmediate(() => no.input.write("\r"));
  assert.equal(await pendingNo, false);

  const yes = keyStreams();
  const pendingYes = promptYesNo("Restart the running server when done?", true, {
    input: yes.input,
    output: yes.output,
    color: false,
  });
  setImmediate(() => yes.input.write("\r"));
  assert.equal(await pendingYes, true);
});
