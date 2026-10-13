"use strict";

const readline = require("node:readline");
const { terminalLines, eraseFrame, wrap } = require("./terminal-ui.js");

function paint(text, code, color) {
  if (!color || text === "") return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}

function reduceChoiceMenu(state, key, count) {
  const name = key?.name;
  const sequence = key?.sequence ?? "";
  if (key?.ctrl && name === "c") return { ...state, action: "cancel" };
  if (name === "escape" || (sequence === "\u001b" && !name)) {
    return { ...state, action: "cancel" };
  }
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

function renderChoiceMenu(state, { color = false, columns = 80 } = {}) {
  const options = state.options ?? [];
  const lines = [paint(wrap(state.title ?? "", columns), "1", color)];
  if (state.detail) lines.push(paint(wrap(state.detail, columns), "2", color));
  lines.push("");
  options.forEach((option, index) => {
    const on = index === state.selected;
    const marker = on ? paint("›", "36", color) : " ";
    const label = paint(option.label, on ? "1" : "2", color);
    lines.push(`  ${marker} ${label}`);
  });
  lines.push("");
  lines.push(paint(wrap("↑↓ move  ·  enter select  ·  esc cancel", columns), "2", color));
  return lines.join("\n");
}

function frameText(frame) {
  return frame.endsWith("\n") ? frame : `${frame}\n`;
}

async function promptChoiceMenu({ title, detail, options, selected = 0, input, output, color } = {}) {
  if (!input || !output) throw new Error("promptChoiceMenu needs input and output streams.");
  if (!Array.isArray(options) || options.length === 0) {
    throw new Error("promptChoiceMenu needs at least one option.");
  }
  const useColor = color ?? (Boolean(output.isTTY) && !process.env.NO_COLOR);
  const wasFlowing = input.readableFlowing;
  readline.emitKeypressEvents(input);
  // A readline question that just closed (the wizard asks for a port, then
  // shows menus) leaves stdin paused. Resume so keypresses flow again.
  if (typeof input.resume === "function") input.resume();
  const wasRaw = Boolean(input.isRaw);
  if (typeof input.setRawMode === "function") input.setRawMode(true);
  if (output.isTTY) output.write("\x1b[?25l");

  let drawn = 0;
  let finished = false;
  let view = {
    title,
    detail: detail ?? "",
    options,
    selected: Math.min(Math.max(selected, 0), options.length - 1),
  };

  const draw = () => {
    const text = frameText(renderChoiceMenu(view, { color: useColor, columns: output.columns }));
    eraseFrame(output, drawn);
    output.write(text);
    drawn = terminalLines(text, output.columns);
  };

  const cleanup = () => {
    input.off("keypress", onKey);
    if (typeof input.setRawMode === "function") input.setRawMode(wasRaw);
    if (output.isTTY) output.write("\x1b[?25h");
    if (wasFlowing !== true && typeof input.pause === "function") input.pause();
  };

  function onKey(_ch, key) {
    if (!key || finished) return;
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
    const option = options[Math.min(view.selected, options.length - 1)];
    eraseFrame(output, drawn);
    output.write(`  ${paint("✓", "32", useColor)} ${title}  ${paint(option.label, "1", useColor)}\n\n`);
    finish(null, option.value);
  }

  let finish = () => {};
  try {
    return await new Promise((resolve, reject) => {
      finish = (error, value) => {
        finished = true;
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
    detail: io.detail || "",
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
