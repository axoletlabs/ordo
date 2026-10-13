"use strict";

const { spawnSync } = require("node:child_process");
const { chmodSync, closeSync, openSync, readSync, statSync, writeSync } = require("node:fs");

// Build tools must never ask questions or advertise upgrades during setup.
// Do not apply CI to the running application; this is only for build commands.
function buildEnvironment(env) {
  return {
    ...env,
    CI: "true",
    NO_UPDATE_NOTIFIER: "1",
    npm_config_update_notifier: "false",
    PRISMA_HIDE_UPDATE_MESSAGE: "1",
  };
}

function logTail(path) {
  const fd = openSync(path, "r");
  try {
    const size = statSync(path).size;
    const bytes = Buffer.alloc(Math.min(size, 16 * 1024));
    readSync(fd, bytes, 0, bytes.length, Math.max(0, size - bytes.length));
    return bytes.toString("utf8").trim().split(/\r?\n/).slice(-20).join("\n");
  } finally {
    closeSync(fd);
  }
}

function runSetupCommand(command, args, { cwd, env, dryRun, log, logPath, verbose = false, foreground = false }) {
  const pretty = [command, ...args].join(" ");
  if (dryRun || verbose) log(`$ ${pretty}`);
  if (dryRun) return;
  const fd = foreground ? null : openSync(logPath, "a", 0o600);
  let result;
  try {
    if (fd != null) {
      chmodSync(logPath, 0o600);
      writeSync(fd, `\n$ ${pretty}\n`);
    }
    result = spawnSync(command, args, {
      cwd,
      env: foreground ? env : buildEnvironment(env),
      // Even --verbose cannot let a tool steal the installer's terminal input.
      stdio: foreground ? "inherit" : ["ignore", verbose ? "inherit" : fd, verbose ? "inherit" : fd],
    });
  } finally {
    if (fd != null) closeSync(fd);
  }
  if (result.status !== 0) {
    if (!foreground && !verbose) log(logTail(logPath));
    throw new Error(`${pretty} failed (${result.status ?? result.error?.message ?? result.signal}).` +
      (foreground || verbose ? "" : `\nDetails: ${logPath}`));
  }
}

module.exports = { buildEnvironment, runSetupCommand };
