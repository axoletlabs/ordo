"use strict";

const readline = require("node:readline");

function plain(text) {
  return String(text).replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
}

function terminalLines(text, columns = 80) {
  return plain(text).replace(/\n$/, "").split("\n")
    .reduce((n, line) => n + Math.max(1, Math.ceil([...line].length / Math.max(1, columns))), 0);
}

function eraseFrame(output, lines) {
  if (!lines || !output.isTTY) return;
  readline.moveCursor(output, 0, -lines);
  readline.cursorTo(output, 0);
  readline.clearScreenDown(output);
}

// Wrap descriptions deliberately so narrow SSH terminals don't corrupt redraws.
function wrap(text, columns = 80, indent = "  ") {
  const width = Math.max(12, Math.min(columns - indent.length - 1, 72));
  const words = plain(text).split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (line && [...`${line} ${word}`].length > width) {
      lines.push(indent + line);
      line = "";
    }
    line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(indent + line);
  return lines.join("\n");
}

module.exports = { terminalLines, eraseFrame, wrap };
