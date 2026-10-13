"use strict";

const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync, rmSync, statSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const test = require("node:test");
const { buildEnvironment, runSetupCommand } = require("./setup-process.js");

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), "ordo-setup-command-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const lines = [];
  return { cwd, env: process.env, logPath: join(cwd, "setup.log"), log: (line) => lines.push(line), lines };
}

test("build environment disables prompts and update notices without mutating the app environment", () => {
  const env = { NODE_ENV: "production", CI: "", PATH: process.env.PATH };
  const result = buildEnvironment(env);
  assert.equal(result.CI, "true");
  assert.equal(result.PRISMA_HIDE_UPDATE_MESSAGE, "1");
  assert.equal(result.npm_config_update_notifier, "false");
  assert.equal(result.NO_UPDATE_NOTIFIER, "1");
  assert.equal(result.NODE_ENV, "production");
  assert.equal(env.CI, "");
});

test("successful tools cannot read terminal input and log both output streams privately", (t) => {
  const opts = fixture(t);
  runSetupCommand(process.execPath, ["-e", `
    const fs = require('node:fs');
    console.log(JSON.stringify({ci: process.env.CI, input: fs.readFileSync(0, 'utf8')}));
    console.error('build warning recorded');
  `], opts);
  const text = readFileSync(opts.logPath, "utf8");
  assert.match(text, /"ci":"true","input":""/);
  assert.match(text, /build warning recorded/);
  assert.equal(opts.lines.length, 0);
  assert.equal(statSync(opts.logPath).mode & 0o777, 0o600);
});

test("failed tools show a bounded log tail and stop with a full log path", (t) => {
  const opts = fixture(t);
  assert.throws(() => runSetupCommand(process.execPath, ["-e", `
    for (let i = 0; i < 100; i++) console.log('line-' + i);
    console.error('real compiler error');
    process.exit(2);
  `], opts), (error) => error.message.includes("failed (2)") && error.message.includes(opts.logPath));
  assert.match(opts.lines.join("\n"), /line-99\nreal compiler error/);
  assert.doesNotMatch(opts.lines.join("\n"), /line-0\n/);
  assert.equal(opts.lines[0].split("\n").length, 20);
  assert.match(readFileSync(opts.logPath, "utf8"), /line-0\n/);
});

test("spawn errors name the missing executable instead of swallowing the failure", (t) => {
  const opts = fixture(t);
  assert.throws(() => runSetupCommand("ordo-missing-test-command", [], opts), /ENOENT/);
});

test("dry run does not execute tools or create a log", (t) => {
  const opts = fixture(t);
  runSetupCommand("ordo-missing-test-command", [], { ...opts, dryRun: true });
  assert.deepEqual(opts.lines, ["$ ordo-missing-test-command"]);
  assert.throws(() => statSync(opts.logPath), /ENOENT/);
});
