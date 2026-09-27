"use strict";

const readline = require("node:readline");

function paint(text, code, color) {
  if (!color || text === "") return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}

function reduceChoiceMenu(state, key, count) {
  const name = key?.name;
  const sequence = key?.sequence ?? "";
  if (key?.ctrl && name === "c") return { ...state, action: "cancel" };
  if (name === "up" || sequence === "\u001b[A" || sequence === "\u001bOA") {
    const last = Math.max(count - 1, 0);
    const selected = state.selected <= 0 ? last : state.selected - 1;
    return { ...state, selected, action: "redraw" };
  }
  if (name === "down" || sequence === "\u001b[B" || sequence === "\u001bOB") {
    const selected = count === 0 ? 0 : (state.selected + 1) % count;
    return { ...state, selected, action: "redraw" };
  }
  if (name === "return" || name === "enter") return { ...state, action: "submit" };
  return { ...state, action: "ignore" };
}

function renderChoiceMenu(state, { color = false } = {}) {
  const options = state.options ?? [];
  const lines = [paint(state.title ?? "", "1", color), ""];
  options.forEach((option, index) => {
    const on = index === state.selected;
    const marker = on ? paint("›", "36", color) : " ";
    const label = paint(option.label, on ? "1" : "2", color);
    lines.push(`  ${marker} ${label}`);
  });
  lines.push("");
  lines.push(paint("  ↑↓ move    enter select", "2", color));
  return lines.join("\n");
}

function frameText(frame) {
  return frame.endsWith("\n") ? frame : `${frame}\n`;
}

async function promptChoiceMenu({ title, options, selected = 0, input, output, color } = {}) {
  if (!input || !output) throw new Error("promptChoiceMenu needs input and output streams.");
  if (!Array.isArray(options) || options.length === 0) {
    throw new Error("promptChoiceMenu needs at least one option.");
  }
  const useColor = color ?? (Boolean(output.isTTY) && !process.env.NO_COLOR);
  readline.emitKeypressEvents(input);
  const wasRaw = Boolean(input.isRaw);
  if (typeof input.setRawMode === "function") input.setRawMode(true);
  if (output.isTTY) output.write("\x1b[?25l");

  let drawn = 0;
  let view = {
    title,
    options,
    selected: Math.min(Math.max(selected, 0), options.length - 1),
  };

  const draw = () => {
    const text = frameText(renderChoiceMenu(view, { color: useColor }));
    if (drawn > 0) output.write(`\x1b[${drawn}A\x1b[J`);
    output.write(text);
    drawn = text.split("\n").length - 1;
  };

  const cleanup = () => {
    input.off("keypress", onKey);
    if (typeof input.setRawMode === "function") input.setRawMode(wasRaw);
    if (output.isTTY) output.write("\x1b[?25h");
  };

  function onKey(_ch, key) {
    if (!key) return;
    const next = reduceChoiceMenu(view, key, options.length);
    if (next.action === "cancel") {
      const error = new Error("Cancelled.");
      error.code = "CANCELLED";
      finish(error);
      return;
    }
    if (next.action === "ignore") return;
    view = { ...view, selected: next.selected };
    if (next.action !== "submit") {
      draw();
      return;
    }
    finish(null, options[Math.min(view.selected, options.length - 1)].value);
  }

  let finish = () => {};
  try {
    return await new Promise((resolve, reject) => {
      finish = (error, value) => {
        if (error) reject(error);
        else resolve(value);
      };
      input.on("keypress", onKey);
      draw();
    });
  } finally {
    cleanup();
  }
}

function promptYesNo(question, fallback, io) {
  return promptChoiceMenu({
    title: question,
    options: [
      { label: "Yes", value: true },
      { label: "No", value: false },
    ],
    selected: fallback ? 0 : 1,
    input: io.input,
    output: io.output,
    color: io.color,
  });
}

module.exports = {
  reduceChoiceMenu,
  renderChoiceMenu,
  promptChoiceMenu,
  promptYesNo,
};
