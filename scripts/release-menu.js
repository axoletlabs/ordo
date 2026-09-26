"use strict";

const readline = require("node:readline");
const { normalizeReleaseSpec, visibleReleases } = require("./server-release.js");

function releaseMenuRows(releases, { installedTag = null, pre = false } = {}) {
  return visibleReleases(releases, { pre }).map((release, index) => {
    const marks = [];
    if (index === 0) marks.push(pre ? "newest" : "latest");
    if (installedTag && release.tag_name === installedTag) marks.push("installed");
    return {
      release,
      tag: release.tag_name,
      channel: release.prerelease ? "pre-release" : "stable",
      date: String(release.published_at ?? release.created_at ?? "").slice(0, 10),
      marks,
    };
  });
}

function hiddenPreCount(releases, { pre = false } = {}) {
  if (pre) return 0;
  return (releases ?? []).filter((release) => release && !release.draft && release.prerelease).length;
}

function filterReleaseRows(rows, query) {
  const needle = String(query ?? "").trim().toLowerCase().replace(/^v/, "");
  if (!needle) return rows;
  return rows.filter((row) => row.tag.toLowerCase().replace(/^v/, "").includes(needle));
}

function reduceReleaseMenu(state, key, rows) {
  const name = key?.name;
  const sequence = key?.sequence ?? "";
  if (key?.ctrl && name === "c") return { ...state, action: "cancel" };
  if (name === "escape") return { ...state, query: "", selected: 0, action: "redraw" };
  if (name === "up" || sequence === "\u001b[A") {
    const last = Math.max(rows.length - 1, 0);
    const selected = state.selected <= 0 ? last : state.selected - 1;
    return { ...state, selected, action: "redraw" };
  }
  if (name === "down" || sequence === "\u001b[B") {
    const selected = rows.length === 0 ? 0 : (state.selected + 1) % rows.length;
    return { ...state, selected, action: "redraw" };
  }
  if (name === "backspace" || name === "delete" || sequence === "\u007f" || sequence === "\b") {
    return { ...state, query: state.query.slice(0, -1), selected: 0, action: "redraw" };
  }
  if (name === "return" || name === "enter") return { ...state, action: "submit" };
  if (key?.ctrl || key?.meta) return { ...state, action: "ignore" };
  if (sequence.length === 1 && sequence >= " ") {
    return { ...state, query: state.query + sequence, selected: 0, action: "redraw" };
  }
  return { ...state, action: "ignore" };
}

function paint(text, code, color) {
  if (!color || text === "") return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}

function renderReleaseMenu(state, { color = false, hiddenPre = 0 } = {}) {
  const rows = state.rows ?? [];
  const lines = [paint("Choose a release", "1", color), ""];
  if (rows.length === 0) {
    lines.push(paint("  No matching release", "2", color));
  }
  rows.forEach((row, index) => {
    const on = index === state.selected;
    const marker = on ? paint("›", "36", color) : " ";
    const tag = paint(row.tag.padEnd(18), on ? "1" : "2", color);
    const rest = `${row.channel.padEnd(12)} ${row.date.padEnd(12)}${row.marks.join(", ")}`;
    lines.push(`  ${marker} ${tag} ${on ? rest : paint(rest, "2", color)}`);
  });
  lines.push("");
  lines.push(`  ${paint("version", "2", color)}  ${state.query ?? ""}`);
  lines.push(paint("  ↑↓ move    enter select    type a version", "2", color));
  if (hiddenPre > 0) {
    const noun = hiddenPre === 1 ? "pre-release" : "pre-releases";
    lines.push(paint(`  ${hiddenPre} ${noun} hidden. Re-run with --pre to include them.`, "2", color));
  }
  return lines.join("\n");
}

function frameText(frame) {
  return frame.endsWith("\n") ? frame : `${frame}\n`;
}

async function promptReleaseMenu({ rows, hiddenPre = 0, input, output, color } = {}) {
  if (!input || !output) throw new Error("promptReleaseMenu needs input and output streams.");
  const useColor = color ?? (Boolean(output.isTTY) && !process.env.NO_COLOR);
  readline.emitKeypressEvents(input);
  const wasRaw = Boolean(input.isRaw);
  if (typeof input.setRawMode === "function") input.setRawMode(true);
  if (output.isTTY) output.write("\x1b[?25l");

  let drawn = 0;
  let view = { query: "", selected: 0, rows };

  const draw = () => {
    const shown = filterReleaseRows(rows, view.query);
    const selected = shown.length === 0 ? 0 : Math.min(view.selected, shown.length - 1);
    view = { ...view, selected, rows: shown };
    const text = frameText(renderReleaseMenu(view, { color: useColor, hiddenPre }));
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
    const shown = filterReleaseRows(rows, view.query);
    const next = reduceReleaseMenu({ query: view.query, selected: view.selected }, key, shown);
    if (next.action === "cancel") {
      const error = new Error("Cancelled.");
      error.code = "CANCELLED";
      finish(error);
      return;
    }
    if (next.action === "ignore") return;
    view = { ...view, query: next.query, selected: next.selected };
    if (next.action !== "submit") {
      draw();
      return;
    }
    const query = view.query.trim();
    const matches = filterReleaseRows(rows, query);
    if (!query && matches.length > 0) {
      finish(null, matches[Math.min(view.selected, matches.length - 1)].release);
      return;
    }
    if (query) {
      try {
        const spec = normalizeReleaseSpec(query, { pre: true });
        if (spec.kind === "latest") {
          if (rows.length === 0) {
            finish(new Error("No release matches."));
            return;
          }
          finish(null, rows[0].release);
          return;
        }
        if (spec.kind === "tag") {
          const exact = rows.find((row) => row.tag === spec.tag);
          if (exact) {
            finish(null, exact.release);
            return;
          }
          const error = new Error(`Release ${spec.tag} is not in the recent list.`);
          error.fetchTag = spec.tag;
          finish(error);
          return;
        }
      } catch {
        // Partial text such as "0.1" filters the list. Enter picks the highlight.
      }
    }
    if (matches.length > 0) {
      finish(null, matches[Math.min(view.selected, matches.length - 1)].release);
      return;
    }
    finish(new Error(`No release matches ${JSON.stringify(query)}.`));
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

module.exports = {
  releaseMenuRows,
  hiddenPreCount,
  filterReleaseRows,
  reduceReleaseMenu,
  renderReleaseMenu,
  promptReleaseMenu,
};
