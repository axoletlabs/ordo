/** Offline notices from the installed mobile production dependency graph.
 * No registry requests, dev dependencies, timestamps, or machine paths in output.
 */
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

const MOBILE_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(MOBILE_ROOT, "../..");
// These tools run on the developer/build host and are never bundled in Ordo.
const BUILD_ONLY = new Set(["@expo/xcpretty", "@react-native/debugger-frontend"]);
const OUTPUT = path.join(MOBILE_ROOT, "src/generated/open-source-licenses.json");
const read = (file) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n").trim();
const json = (file) => JSON.parse(read(file));
const FALLBACKS = json(path.join(MOBILE_ROOT, "licenses/package-fallbacks.json"));
const SOURCES = json(path.join(MOBILE_ROOT, "licenses/sources.json"));

function resolvePackage(name, from) {
  // Walking module search paths also works for packages that hide package.json
  // with an exports map, and with both hoisted and isolated pnpm installs.
  for (const modules of createRequire(path.join(from, "package.json")).resolve.paths(name) ?? []) {
    const candidate = path.join(modules, name);
    if (fs.existsSync(path.join(candidate, "package.json"))) return fs.realpathSync(candidate);
  }
  return null;
}

function noticeFiles(directory, prefix = "", depth = 0) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    if (entry.isFile() && /^(licen[cs]e|copying|copyright|notice|ofl|unlicen[cs]e)([._-]|$)/i.test(entry.name)) {
      files.push(relative);
    } else if (entry.isDirectory() && depth < 6 && (prefix || /^(licen[cs]es?|notices?)$/i.test(entry.name))) {
      files.push(...noticeFiles(path.join(directory, entry.name), relative, depth + 1));
    } else if (prefix && entry.isFile()) {
      files.push(relative);
    }
  }
  return files.sort();
}

function collectPackages(root, { fallbacks = FALLBACKS } = {}) {
  const seen = new Set();
  const entries = new Map();
  const missing = [];
  function visit(directory) {
    directory = fs.realpathSync(directory);
    if (seen.has(directory)) return;
    seen.add(directory);
    const pkg = json(path.join(directory, "package.json"));
    if (!pkg.name.startsWith("@ordo/") && directory !== root && !BUILD_ONLY.has(pkg.name)) {
      const files = noticeFiles(directory);
      const notices = files.map((file) => ({ title: file.replaceAll(path.sep, "/"), text: read(path.join(directory, file)) })).filter((notice) => notice.text.length > 0);
      const hasLicenseText = () => notices.some((notice) =>
        /^(licen[cs]e|copying|ofl|unlicen[cs]e)([._-]|$)/i.test(path.basename(notice.title)) ||
        /Permission (?:is hereby granted|to use, copy)|Redistribution and use|TERMS AND CONDITIONS/i.test(notice.text));
      if (!hasLicenseText()) {
        const readme = fs.readdirSync(directory).find((name) => /^readme(\.md|\.markdown|\.txt)?$/i.test(name));
        const section = readme && read(path.join(directory, readme)).match(/^#{1,2}\s+licen[cs]e\b[^\n]*\n([\s\S]*?)(?=^#{1,2}\s|$(?![\s\S]))/im)?.[1]?.trim();
        if (section && /Permission (?:is hereby granted|to use, copy)|Redistribution and use|TERMS AND CONDITIONS/i.test(section)) notices.push({ title: "License (from README)", text: section });
      }
      if (!hasLicenseText() && fallbacks[`${pkg.name}@${pkg.version}`]) {
        const fallback = fallbacks[`${pkg.name}@${pkg.version}`];
        if (fallback.license !== pkg.license) throw new Error(`License changed for ${pkg.name}; review its fallback.`);
        for (const sourceId of [fallback.source, ...(fallback.additionalSources ?? [])]) {
          const source = SOURCES[sourceId];
          notices.push({ title: "Copyright and license", text: read(path.join(MOBILE_ROOT, "licenses", source.file)) });
        }
        if (fallback.copyright) notices.unshift({ title: "Copyright", text: fallback.copyright });
      }
      if (!hasLicenseText()) missing.push(`${pkg.name}@${pkg.version}: no license text found`);
      const license = typeof pkg.license === "string" ? pkg.license : pkg.license?.type;
      if (!license) missing.push(`${pkg.name}@${pkg.version}: no license identifier`);
      const id = `${pkg.name}@${pkg.version}`;
      // The same version may have multiple peer resolutions; preserve distinct notices.
      const previous = entries.get(id);
      const merged = [...(previous?.notices ?? []), ...notices];
      entries.set(id, { id, name: pkg.name, version: pkg.version, license: license ?? "Unknown", kind: "package",
        notices: merged.filter((notice, index) => merged.findIndex((other) => other.title === notice.title && other.text === notice.text) === index) });
    }
    const required = pkg.dependencies ?? {};
    const optional = pkg.optionalDependencies ?? {};
    // Installed peers can also supply runtime code; missing optional/platform peers are fine.
    for (const name of new Set([...Object.keys(required), ...Object.keys(optional), ...Object.keys(pkg.peerDependencies ?? {})])) {
      const resolved = resolvePackage(name, directory);
      if (resolved) visit(resolved);
      else if (name in required && !(name in optional)) missing.push(`${pkg.name}: missing dependency ${name}; run pnpm install`);
    }
  }
  visit(root);
  if (missing.length) throw new Error(`Cannot generate complete notices:\n${missing.sort().join("\n")}`);
  return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name, "en") || a.version.localeCompare(b.version, "en"));
}

function generateLicenses({ root = MOBILE_ROOT, output = OUTPUT } = {}) {
  const packages = collectPackages(root);
  const materialLoadingLicense = read(path.join(MOBILE_ROOT, "src/lib/material-loading.LICENSE"));
  const apacheLicense = materialLoadingLicense.slice(materialLoadingLicense.indexOf("Apache License"));
  const assets = [
    ["libron", "Libron", "OFL-1.1", "assets/fonts/LICENSE-Libron.txt"],
    ["legible", "NV Legible Next", "OFL-1.1", "assets/fonts/LICENSE-NVLegibleNext.txt"],
    ["garamond", "NV Garamond", "OFL-1.1", "assets/fonts/LICENSE-NVGaramond.txt"],
    ["bitter", "NV Bitter", "OFL-1.1", "assets/fonts/LICENSE-NVBitter.txt"],
    ["jost", "NV Jost", "OFL-1.1", "assets/fonts/LICENSE-NVJost.txt"],
    ["material-icons", "Material Icons", "Apache-2.0", "assets/fonts/LICENSE-MaterialIcons.txt"],
    ["material-loading", "AndroidX Material loading shapes", "Apache-2.0", "src/lib/material-loading.LICENSE"],
  ].map(([id, name, license, file]) => ({ id, name, license, version: "", kind: "asset", notices: [
    { title: "Copyright and license", text: read(path.join(MOBILE_ROOT, file)) },
    ...(id === "material-icons" ? [{ title: "Apache License 2.0", text: apacheLicense }] : []),
  ] }));
  const data = {
    ordo: { id: "ordo", name: "Ordo", license: "AGPL-3.0", version: "", kind: "app", notices: [
      { title: "Copyright", text: "Copyright 2026 Axolet and Ordo contributors.\n\nOrdo is free software. You may redistribute and modify it under the GNU Affero General Public License, version 3. Ordo comes without any warranty; see the license for details." },
      { title: "GNU Affero General Public License", text: read(path.join(REPO_ROOT, "LICENSE")) },
    ] },
    entries: [...assets, ...packages],
  };
  const contents = `${JSON.stringify(data)}\n`;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  if (!fs.existsSync(output) || fs.readFileSync(output, "utf8") !== contents) fs.writeFileSync(output, contents);
  return data;
}

module.exports = { collectPackages, generateLicenses };
if (require.main === module) {
  const data = generateLicenses();
  console.log(`Generated ${data.entries.length} open source notices.`);
}
