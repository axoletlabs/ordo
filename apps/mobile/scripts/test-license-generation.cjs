const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { test } = require("node:test");
const { collectPackages, generateLicenses } = require("./generate-licenses.cjs");

const MIT = "Copyright (c) Example authors\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software.\nTHE SOFTWARE IS PROVIDED AS IS.";
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ordo-licenses-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function pkg(directory, metadata, files = {}) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({ version: "1.0.0", license: "MIT", ...metadata }));
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    fs.writeFileSync(path.join(directory, file), text);
  }
}

test("walks runtime, workspace and installed peer dependencies; excludes dev and missing optional dependencies", (t) => {
  const root = fixture(t);
  pkg(root, { name: "@ordo/mobile", dependencies: { a: "1", "@ordo/shared": "1" }, devDependencies: { dev: "1" }, optionalDependencies: { absent: "1" } });
  pkg(path.join(root, "node_modules/a"), { name: "a", dependencies: { nested: "2" }, peerDependencies: { peer: "1", absentPeer: "1" } }, { LICENSE: MIT, NOTICE: "Keep this acknowledgment" });
  pkg(path.join(root, "node_modules/a/node_modules/nested"), { name: "nested", version: "2.0.0" }, { "LICENSE.md": MIT });
  pkg(path.join(root, "node_modules/@ordo/shared"), { name: "@ordo/shared", dependencies: { nested: "1" } });
  pkg(path.join(root, "node_modules/nested"), { name: "nested" }, { COPYING: MIT });
  pkg(path.join(root, "node_modules/peer"), { name: "peer" }, { "licenses/third-party.txt": MIT });
  pkg(path.join(root, "node_modules/dev"), { name: "dev" });
  const entries = collectPackages(root, { fallbacks: {} });
  assert.deepEqual(entries.map((entry) => entry.id), ["a@1.0.0", "nested@1.0.0", "nested@2.0.0", "peer@1.0.0"]);
  assert.equal(entries[0].notices.find((notice) => notice.title === "NOTICE").text, "Keep this acknowledgment");
});

test("fails on missing dependencies or license text; a README license identifier alone is insufficient", (t) => {
  const root = fixture(t);
  pkg(root, { name: "root", dependencies: { absent: "1" } });
  assert.throws(() => collectPackages(root, { fallbacks: {} }), /missing dependency absent/);
  pkg(path.join(root, "node_modules/absent"), { name: "absent" }, { "README.md": "# Example\n\n## License\nMIT\n" });
  assert.throws(() => collectPackages(root, { fallbacks: {} }), /no license text found/);
  fs.writeFileSync(path.join(root, "node_modules/absent/NOTICE"), "Copyright Example authors");
  fs.writeFileSync(path.join(root, "node_modules/absent/LICENSE"), "");
  assert.throws(() => collectPackages(root, { fallbacks: {} }), /no license text found/);
  fs.writeFileSync(path.join(root, "node_modules/absent/README.md"), `# Example\n\n## License\n${MIT}\n`);
  assert.equal(collectPackages(root, { fallbacks: {} })[0].notices.find((notice) => notice.title.includes("README")).text, MIT);
});

test("bundles fonts, adapted code and Ordo's license with deterministic output and no host paths", (t) => {
  const root = fixture(t);
  pkg(root, { name: "root", dependencies: { library: "1" } });
  pkg(path.join(root, "node_modules/library"), { name: "library" }, { LICENSE: MIT });
  const output = path.join(root, "generated/notices.json");
  const data = generateLicenses({ root, output });
  const first = fs.readFileSync(output, "utf8");
  const mtime = fs.statSync(output).mtimeMs;
  generateLicenses({ root, output });
  assert.equal(fs.readFileSync(output, "utf8"), first);
  assert.equal(fs.statSync(output).mtimeMs, mtime);
  assert.ok(!first.includes(root));
  assert.match(data.ordo.notices[1].text, /GNU AFFERO GENERAL PUBLIC LICENSE/);
  for (const id of ["libron", "legible", "garamond", "bitter", "jost", "material-icons", "material-loading"]) {
    const entry = data.entries.find((item) => item.id === id);
    assert.ok(entry?.notices.every((notice) => notice.text.length > 200), id);
  }
  assert.match(data.entries.find((entry) => entry.id === "material-icons").notices[1].text, /Redistribution/);
});

test("vendored upstream notices retain their recorded source blob hashes", () => {
  const directory = path.resolve(__dirname, "../licenses");
  const sources = JSON.parse(fs.readFileSync(path.join(directory, "sources.json"), "utf8"));
  for (const source of Object.values(sources)) {
    const contents = fs.readFileSync(path.join(directory, source.file));
    const hash = createHash("sha1").update(`blob ${contents.length}\0`).update(contents).digest("hex");
    assert.equal(hash, source.sha, source.file);
  }
});
