/** Fault/transition fixtures for the real CI baseline, wait and runtime scripts. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const scripts = path.join(root, '.github/scripts');
const job = (name, status = 'completed', conclusion = 'success') => ({ name, status, conclusion, id: 123 });
const detect = job('detect');
const skipped = job('build_apk', 'completed', 'skipped');
const cases = [
  ['deciding', []],
  ['deciding', [job('detect', 'queued', null)]],
  ['deciding', [detect, skipped]], // Matrix/assembly not yet visible in the API.
  ['building', [detect, skipped, job('build_abi (arm64-v8a)', 'in_progress', null)]],
  ['building', [detect, skipped, job('build_abi (arm64-v8a)')]], // Await assembly.
  ['building', [detect, skipped, job('assemble_release', 'waiting', null)]],
  ['built', [detect, skipped, job('assemble_release')]],
  ['built', [detect, job('build_apk'), job('assemble_release', 'completed', 'skipped')]],
  ['no-apk', [detect, skipped, job('assemble_release', 'completed', 'skipped')]],
  ['failed', [job('detect', 'completed', 'failure')]],
  ['failed', [detect, skipped, job('analyze', 'completed', 'failure')]],
  ['failed', [detect, skipped, job('build_abi (x86)', 'completed', 'cancelled'), job('assemble_release', 'completed', 'skipped')]],
  ['failed', [detect, job('build_apk', 'completed', 'timed_out')]],
];
for (const [expected, jobs] of cases) {
  assert.equal(execFileSync('jq', ['-r', '-f', path.join(scripts, 'ci-apk-state.jq')], {
    input: JSON.stringify(jobs), encoding: 'utf8',
  }).trim(), expected, JSON.stringify(jobs));
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ordo-ci-state-'));
try {
  const fixtureFile = path.join(temp, 'fixture.json');
  fs.writeFileSync(path.join(temp, 'gh'), `#!/usr/bin/env node
const fs = require('node:fs');
const cp = require('node:child_process');
const path = require('node:path');
const fixture = JSON.parse(fs.readFileSync(process.env.ORDO_CI_FIXTURE, 'utf8'));
const args = process.argv.slice(2);
if (args[0] === 'run' && args[1] === 'download') {
  const dir = args[args.indexOf('-D') + 1];
  fs.writeFileSync(path.join(dir, 'android-runtime-version.txt'), fixture.runtime);
  process.exit(0);
}
if (args[0] !== 'api') throw new Error('Unexpected gh call: ' + args.join(' '));
const endpoint = args[1];
let data;
if (endpoint.includes('/jobs')) data = { jobs: fixture.jobs };
else if (endpoint.includes('/workflows/')) {
  const query = new URL('https://fixture/' + endpoint).searchParams;
  const matches = (query.get('branch') === 'release/0.3.0' || query.get('head_sha') === fixture.sha) && (!query.get('page') || query.get('page') === '1');
  data = { workflow_runs: matches && query.get('status') === fixture.runStatus
    ? [{ id: 100, head_sha: fixture.sha, head_branch: 'release/0.3.0', event: 'push', created_at: '2026-11-01' }] : [] };
} else if (endpoint.endsWith('/runs/100')) data = { head_sha: fixture.sha };
else throw new Error('Unexpected API: ' + endpoint);
const filter = args.indexOf('--jq');
process.stdout.write(filter < 0 ? JSON.stringify(data) : cp.execFileSync('jq', ['-r', args[filter + 1]], { input: JSON.stringify(data) }));
`, { mode: 0o755 });
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const runtime = 'a'.repeat(40);
  const env = {
    ...process.env, PATH: `${temp}:${process.env.PATH}`, ORDO_CI_FIXTURE: fixtureFile,
    GITHUB_REPOSITORY: 'fixture/repo', GITHUB_RUN_ID: '200', CURRENT_SHA: sha,
    WAIT_FOR_APK_TIMEOUT_S: '0', APP_VERSION: '0.3.0',
  };
  const fixture = (jobs, runStatus = 'completed') => fs.writeFileSync(fixtureFile, JSON.stringify({ jobs, runStatus, sha, runtime }));
  const run = (name, ...args) => spawnSync('bash', [path.join(scripts, name), ...args], { cwd: root, env, encoding: 'utf8', timeout: 20_000 });
  const success = result => {
    assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
    return result.stdout.trim();
  };
  fixture([detect, skipped, job('assemble_release')]);
  assert.equal(success(run('last-apk-shas.sh', 'release/0.3.0', '1')), sha, 'a matrix release is a shipped baseline');
  assert.equal(success(run('apk-embedded-runtime.sh', '--sha', sha, '--branch', 'release/0.3.0')), runtime, 'a skipped single build cannot hide successful assembly');
  fixture([detect, skipped, job('build_abi (arm64-v8a)', 'in_progress', null)], 'in_progress');
  assert.equal(success(run('apk-baseline-sha.sh', 'release/0.3.0')), sha, 'an active matrix is a candidate baseline');
  const waiting = run('wait-for-in-flight-apk.sh', 'release/0.3.0');
  assert.equal(waiting.status, 1);
  assert.match(waiting.stdout, /Timed out/, 'OTA waits until assembly finishes');
  fixture([job('detect', 'completed', 'cancelled')], 'in_progress');
  success(run('wait-for-in-flight-apk.sh', 'release/0.3.0'));
  fixture([detect, job('build_apk', 'completed', 'failure')]);
  assert.equal(run('apk-embedded-runtime.sh', '--run-id', '100').status, 1, 'a runtime artifact without a shipped binary is not eligible');
  console.log('CI APK state, baseline selection, OTA waiting and runtime checks passed.');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
