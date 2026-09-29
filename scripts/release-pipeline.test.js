const assert = require("node:assert/strict");
const { test } = require("node:test");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const yaml = require("js-yaml");
const policy = require("./release-policy.js");
const root = resolve(__dirname, "..");
const workflow = yaml.load(readFileSync(join(root, ".github/workflows/ci.yml"), "utf8"));

function runStep(name, { expressions = {}, env = {} } = {}) {
  const step = workflow.jobs.detect.steps.find((step) => step.name === name);
  const temp = mkdtempSync(join(tmpdir(), "ordo-route-"));
  const output = join(temp, "output");
  writeFileSync(output, "");
  try {
    const run = step.run.replace(/\$\{\{\s*(.*?)\s*\}\}/g, (_all, key) => expressions[key] ?? "");
    const result = spawnSync("bash", ["-e", "-c", run], { cwd: root, encoding: "utf8", env: {
      ...process.env, GITHUB_WORKSPACE: root, GITHUB_OUTPUT: output, ...env,
    } });
    return { ...result, output: Object.fromEntries(readFileSync(output, "utf8").trim().split("\n").filter(Boolean).map((line) => {
      const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1)];
    })) };
  } finally { rmSync(temp, { recursive: true, force: true }); }
}

test("every distributor is gated by tests and dependency audit, including releases", () => {
  for (const name of ["ota", "build_apk", "package_server"]) {
    assert.ok(workflow.jobs[name].needs.includes("analyze"), name);
    assert.ok(workflow.jobs[name].needs.includes("supply-chain"), name);
  }
  assert.ok(workflow.jobs.release.needs.includes("package_server"));
  assert.ok(workflow.on.pull_request != null || "pull_request" in workflow.on);
  assert.ok(!workflow.jobs.analyze.if.includes("event_name"), "release checks cannot be skipped");
  assert.equal(workflow.jobs.analyze.concurrency["cancel-in-progress"], false, "later JS pushes must not kill an APK's gate");
  const steps = workflow.jobs.build_apk.steps;
  const verify = steps.findIndex((step) => step.name === "Verify packaged APK signing, versions, runtime and channel");
  const upload = steps.findIndex((step) => step.name === "Upload verified Android runtime version");
  assert.ok(verify >= 0 && upload > verify, "APK runtimes must be verified before becoming a routing baseline");
  assert.equal(steps[upload].with.overwrite, true, "a workflow retry must be able to upload its artifact");
});

test("routing matrix covers pushes, branches, forced builds and release events", () => {
  for (const [event, ref, native, message, forced, expected] of [
    ["push", "refs/heads/main", "false", "JS fix", "", "false"],
    ["push", "refs/heads/main", "true", "native fix", "", "true"],
    ["push", "refs/heads/release/0.1.0", "true", "native fix", "", "true"],
    ["push", "refs/heads/feature", "true", "feature fix", "", "false"],
    ["push", "refs/heads/feature", "false", "feature fix -apk", "", "true"],
    ["push", "refs/heads/main", "false", "first line\nbody -apk", "", "false"],
    ["release", "refs/tags/v0.1.0", "false", "", "", "true"],
    ["workflow_dispatch", "refs/heads/main", "true", "", "false", "false"],
    ["workflow_dispatch", "refs/heads/main", "false", "", "true", "true"],
  ]) {
    const result = runStep("Select OTA or APK build", {
      expressions: { "github.ref": ref, "github.event_name": event },
      env: { NATIVE_CHANGED: native, COMMIT_MSG: message, BUILD_INPUT: forced, GITHUB_REF: ref, GITHUB_EVENT_NAME: event },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.output.should_build, expected, `${event} ${ref} ${message}`);
  }
});

test("CI version codes advance across retries and builds without ABI inversion", () => {
  const codes = [];
  for (const [run, attempt] of [[400, 1], [400, 2], [401, 1]]) {
    const result = runStep("Gather trigger info", {
      expressions: { "github.run_number": String(run), "github.run_attempt": String(attempt), "github.event_name": "push", "github.sha": "abc" },
      env: { GITHUB_REF_NAME: "main" },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.output.updates_channel, "development");
    codes.push(Number(result.output.version_code));
  }
  assert.ok(codes[1] * 10 > codes[0] * 10 + 4);
  assert.ok(codes[2] * 10 > codes[1] * 10 + 4);
});

test("CLI and app policy reject malformed tags, release targets and marker drift", () => {
  for (const [tag, version, pre, okay] of [
    ["v0.2.0", "0.2.0", "false", true],
    ["v0.2.0-beta.1", "0.2.0-beta.1", "true", true],
    ["v0.2.0-beta.1", "0.2.0-beta.1", "false", false],
    ["v0.2.0", "0.2.0", "true", false],
    ["v0.2.0", "0.1.0", "false", false],
    ["v0.02.0", "0.02.0", "false", false],
    ["v0.2.0", "0.2.0", "typo", false],
  ]) {
    const result = spawnSync("node", [join(root, ".github/scripts/validate-release-tag.js"), tag, version, pre]);
    assert.equal(result.status === 0, okay, `${tag} ${pre}`);
  }
  assert.equal(policy.validateReleaseBranch("v0.2.0-junk", "release/0.2.0") != null, true);
  assert.equal(policy.resolveUpdatesChannel("0.2.0", "release/0.1.0"), null);
});

function apkFixture(t, dataset) {
  const temp = mkdtempSync(join(tmpdir(), "ordo-apk-ci-"));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  // Hermetic git history: CI checkouts can be shallow, so ancestry checks
  // must never resolve real repository commits.
  const repo = join(temp, "repo");
  mkdirSync(repo);
  const git = (args) => spawnSync("git", ["-c", "user.email=ordo-test@example.com", "-c", "user.name=ordo-test", ...args], { cwd: repo, encoding: "utf8" });
  git(["init", "-q", "-b", "main"]);
  for (const name of ["one.txt", "two.txt", "three.txt"]) {
    writeFileSync(join(repo, name), name);
    git(["add", "."]);
    git(["commit", "-m", name]);
  }
  const head = git(["rev-parse", "HEAD"]).stdout.trim();
  const parent = git(["rev-parse", "HEAD~1"]).stdout.trim();
  assert.ok(/^[0-9a-f]{40}$/.test(head) && /^[0-9a-f]{40}$/.test(parent), "fixture history must resolve");
  const bin = join(temp, "bin");
  mkdirSync(bin);
  const data = join(temp, "data.json");
  writeFileSync(data, JSON.stringify(dataset));
  writeFileSync(join(bin, "gh"), `#!/usr/bin/env node
const fs=require('node:fs'), cp=require('node:child_process');
const d=JSON.parse(fs.readFileSync(process.env.APK_TEST_DATA,'utf8'));
const a=process.argv.slice(2);
if(a[0]==='api') {
 const url=new URL('https://example.test/'+a[1]);
 if(d.fail) process.exit(1);
 let body;
 const match=url.pathname.match(/actions\\/runs\\/(\\d+)(\\/jobs)?$/);
 if(match) body=match[2] ? {jobs:d.jobs[match[1]]||[]} : {head_sha:d.shas?.[match[1]]};
 else body={workflow_runs: (d.branchRuns?.[url.searchParams.get('branch')]?.[url.searchParams.get('status')]||d.runs?.[url.searchParams.get('status')]||[]).filter(r=>!url.searchParams.get('head_sha')||r.head_sha===url.searchParams.get('head_sha'))};
 const jq=a[a.indexOf('--jq')+1];
 const result=cp.spawnSync('jq',['-r',jq],{input:JSON.stringify(body),encoding:'utf8'});
 process.stdout.write(result.stdout); process.exit(result.status);
}
if(a[0]==='run'&&a[1]==='download'&&d.runtime) {
 const dir=a[a.indexOf('-D')+1]; fs.writeFileSync(dir+'/android-runtime-version.txt',d.runtime+'\\n'); process.exit(0);
}
process.exit(1);
`, { mode: 0o755 });
  function run(script, args = [], moreEnv = {}) {
    return spawnSync("bash", [join(root, ".github/scripts", script), ...args], {
      cwd: repo, encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`,
        APK_TEST_DATA: data, GITHUB_REPOSITORY: "test/ordo", GITHUB_RUN_ID: "20", CURRENT_SHA: head,
        WAIT_FOR_APK_TIMEOUT_S: "0", WAIT_FOR_APK_SLEEP_S: "0", ...moreEnv },
    });
  }
  return { run, head, parent, update: (d) => writeFileSync(data, JSON.stringify(d)) };
}

test("baseline uses APK-producing ancestors, skips JS-only and unknown future commits", (t) => {
  const f = apkFixture(t, {});
  f.update({ runs: { in_progress: [
    { id: 19, head_sha: "f".repeat(40), created_at: "3" },
    { id: 18, head_sha: f.head, created_at: "2" },
    { id: 17, head_sha: f.parent, created_at: "1" },
  ] }, jobs: {
    19: [{ name: "detect", status: "in_progress" }],
    18: [{ name: "detect", status: "completed" }, { name: "build_apk", status: "completed", conclusion: "skipped" }],
    17: [{ name: "build_apk", status: "in_progress" }],
  } });
  const result = f.run("apk-baseline-sha.sh", ["main"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), f.parent);
});

test("last APK scan uses job success even if another job failed and deduplicates SHAs", (t) => {
  const f = apkFixture(t, {});
  f.update({ runs: { completed: [{ id: 19 }, { id: 18 }, { id: 17 }, { id: 16 }] }, jobs: {
    19: [{ name: "build_apk", conclusion: "skipped" }],
    18: [{ name: "build_apk", conclusion: "success" }],
    17: [{ name: "build_apk", conclusion: "success" }],
    16: [{ name: "build_apk", conclusion: "success" }],
  }, shas: { 18: f.head, 17: f.head, 16: f.parent } });
  const result = f.run("last-apk-shas.sh", ["main", "2"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), `${f.head}\n${f.parent}`);
});

test("APK wait ignores newer runs, blocks pending binaries and fails closed on API failure", (t) => {
  const f = apkFixture(t, { runs: { in_progress: [{ id: 21 }] }, jobs: {} });
  assert.equal(f.run("wait-for-in-flight-apk.sh", ["main"]).status, 0);
  f.update({ runs: { in_progress: [{ id: 19 }] }, jobs: { 19: [{ name: "build_apk", status: "in_progress" }] } });
  assert.equal(f.run("wait-for-in-flight-apk.sh", ["main"]).status, 1);
  f.update({ fail: true });
  assert.notEqual(f.run("wait-for-in-flight-apk.sh", ["main"]).status, 0);
});

test("embedded runtime is taken from a successful APK artifact and absent runtimes fail", (t) => {
  const f = apkFixture(t, {});
  f.update({ runs: { completed: [{ id: 18, head_sha: f.head, head_branch: "main" }] }, jobs: { 18: [{ name: "build_apk", conclusion: "success" }] }, runtime: "a".repeat(40) });
  const result = f.run("apk-embedded-runtime.sh", ["--sha", f.head, "--branch", "main"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "a".repeat(40));
  f.update({ runs: {}, jobs: {} });
  assert.equal(f.run("apk-embedded-runtime.sh", ["--sha", f.head]).status, 1);
});

test("published tags count as their release branch's APK baseline and in-flight wait", (t) => {
  const f = apkFixture(t, {});
  const tagged = { id: 19, head_sha: f.parent, head_branch: "v0.1.1", event: "release", created_at: "2" };
  f.update({ branchRuns: {
    "release/0.1.1": { in_progress: [] },
    "v0.1.1": { in_progress: [tagged] },
  }, jobs: { 19: [{ name: "build_apk", status: "in_progress" }] } });
  const baseline = f.run("apk-baseline-sha.sh", ["release/0.1.1"], { APP_VERSION: "0.1.1" });
  assert.equal(baseline.status, 0, baseline.stderr);
  assert.equal(baseline.stdout.trim(), f.parent);
  assert.equal(f.run("wait-for-in-flight-apk.sh", ["release/0.1.1"], { APP_VERSION: "0.1.1" }).status, 1);
  f.update({ runs: { completed: [
    { id: 21, head_sha: f.parent, head_branch: "feature", event: "workflow_dispatch" }, tagged,
  ] }, jobs: {
    21: [{ name: "build_apk", conclusion: "success" }], 19: [{ name: "build_apk", conclusion: "success" }],
  }, runtime: "b".repeat(40) });
  const runtime = f.run("apk-embedded-runtime.sh", ["--sha", f.parent, "--branch", "release/0.1.1"], { APP_VERSION: "0.1.1" });
  assert.equal(runtime.status, 0, runtime.stderr);
  assert.equal(runtime.stdout.trim(), "b".repeat(40));
});

test("server archive packaging is reproducible and records the exact source commit", (t) => {
  const out = mkdtempSync(join(tmpdir(), "ordo-package-"));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const sha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
  function pack(dir) {
    const result = spawnSync("bash", [join(root, ".github/scripts/package-server-archive.sh"), "0.1.0", "v0.1.0", sha, dir], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return readFileSync(join(dir, "ordo-server-v0.1.0.tar.gz"));
  }
  assert.deepEqual(pack(join(out, "a")), pack(join(out, "b")));
  const manifest = spawnSync("tar", ["-xOzf", join(out, "a/ordo-server-v0.1.0.tar.gz"), "ordo-server/apps/server/release.json"], { encoding: "utf8" });
  assert.equal(JSON.parse(manifest.stdout).commit, sha);
  assert.ok(JSON.parse(manifest.stdout).files.includes("scripts/deploy-server.js"));
  const invalid = spawnSync("bash", [join(root, ".github/scripts/package-server-archive.sh"), "0.1.0", "v0.2.0", sha, join(out, "invalid")]);
  assert.notEqual(invalid.status, 0);
});

test("publication always sets the SDK 57 environment and deduplicates runtimes", (t) => {
  const temp = mkdtempSync(join(tmpdir(), "ordo-ota-publish-"));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const log = join(temp, "calls");
  writeFileSync(join(temp, "eas"), `#!/usr/bin/env node
require('node:fs').appendFileSync(process.env.EAS_TEST_LOG,JSON.stringify({args:process.argv.slice(2),runtime:process.env.ORDO_OTA_RUNTIME_VERSION})+'\\n');
`, { mode: 0o755 });
  const step = workflow.jobs.ota.steps.find((step) => step.name === "Publish update");
  for (const [channel, environment] of [["production", "production"], ["early-access", "preview"], ["development", "development"]]) {
    writeFileSync(log, "");
    const result = spawnSync("bash", ["-e", "-c", step.run], { cwd: root, encoding: "utf8", env: {
      ...process.env, PATH: `${temp}:${process.env.PATH}`, EAS_TEST_LOG: log, CHANNEL: channel,
      EXTRA_RUNTIMES: `${"a".repeat(40)} ${"b".repeat(40)} ${"a".repeat(40)}`,
    } });
    assert.equal(result.status, 0, result.stderr);
    const calls = readFileSync(log, "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].args.includes("--skip-bundler"), false);
    assert.equal(calls[1].args.includes("--skip-bundler"), true);
    for (const call of calls) {
      assert.equal(call.args[call.args.indexOf("--environment") + 1], environment);
      assert.equal(call.args[call.args.indexOf("--channel") + 1], channel);
      assert.match(call.runtime, /^[ab]{40}$/);
    }
  }
});

test("channel initialization reuses an existing channel and links a missing one", (t) => {
  const temp = mkdtempSync(join(tmpdir(), "ordo-channel-"));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const log = join(temp, "calls");
  writeFileSync(join(temp, "eas"), `#!/usr/bin/env node
const a=process.argv.slice(2); require('node:fs').appendFileSync(process.env.EAS_TEST_LOG,JSON.stringify(a)+'\\n');
if(a[0]==='channel:view'&&process.env.EAS_TEST_EXISTS!=='true') process.exit(1);
`, { mode: 0o755 });
  for (const exists of ["true", "false"]) {
    writeFileSync(log, "");
    const result = spawnSync("bash", [join(root, ".github/scripts/ensure-updates-channel.sh")], { env: {
      ...process.env, PATH: `${temp}:${process.env.PATH}`, EAS_TEST_LOG: log,
      EAS_TEST_EXISTS: exists, EXPO_UPDATES_CHANNEL: "early-access",
    } });
    assert.equal(result.status, 0);
    const calls = readFileSync(log, "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(calls.length, exists === "true" ? 1 : 2);
    if (exists === "false") assert.deepEqual(calls[1], ["channel:create", "early-access", "--non-interactive"]);
  }
});

test("release upload retries reuse identical assets and refuse to replace different bytes", (t) => {
  const temp = mkdtempSync(join(tmpdir(), "ordo-upload-"));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const asset = join(temp, "app.apk");
  const dataset = join(temp, "release.json");
  const log = join(temp, "uploads");
  const digest = "sha256:" + require("node:crypto").createHash("sha256").update("APK bytes").digest("hex");
  writeFileSync(asset, "APK bytes");
  writeFileSync(join(temp, "gh"), `#!/usr/bin/env node
const fs=require('node:fs'); const a=process.argv.slice(2);
if(a[0]==='api') process.stdout.write(fs.readFileSync(process.env.UPLOAD_TEST_DATA,'utf8'));
else fs.appendFileSync(process.env.UPLOAD_TEST_LOG,JSON.stringify(a)+'\\n');
`, { mode: 0o755 });
  function upload(assets) {
    writeFileSync(dataset, JSON.stringify({ assets }));
    writeFileSync(log, "");
    return spawnSync("bash", [join(root, ".github/scripts/upload-release-assets.sh"), "v0.1.0", asset], { encoding: "utf8", env: {
      ...process.env, PATH: `${temp}:${process.env.PATH}`, GITHUB_REPOSITORY: "test/ordo",
      UPLOAD_TEST_DATA: dataset, UPLOAD_TEST_LOG: log,
    } });
  }
  assert.equal(upload([{ name: "app.apk", digest }]).status, 0);
  assert.equal(readFileSync(log, "utf8"), "");
  assert.equal(upload([{ name: "app.apk", digest: "sha256:" + "0".repeat(64) }]).status, 1);
  assert.equal(readFileSync(log, "utf8"), "");
  assert.equal(upload([]).status, 0);
  const args = JSON.parse(readFileSync(log, "utf8").trim());
  assert.equal(args.includes("--clobber"), false);
  assert.deepEqual(args.slice(0, 3), ["release", "upload", "v0.1.0"]);
});
