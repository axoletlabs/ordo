import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";
import { transformSync } from "@babel/core";
import React from "react";

const root = resolve(import.meta.dirname, "../src");
const require = createRequire(import.meta.url);
const compiled = new Map();
const codes = ["0123-4567", "8901-2345"];
const body = "ordo backup codes\nEach code signs you in once. Keep this file somewhere safe.\n\n0123-4567\n8901-2345\n";

/** Exercise the real dialog and file helpers, mocking native and UI services. */
function harness({ os = "android", saveError, cacheDirectory = "file:///cache/" } = {}) {
  const writes = [], saves = [], shares = [], deletes = [], feedback = [];
  const cache = new Map();
  let saving = false;
  const services = {
    react: { ...React, useState: () => [saving, value => { saving = value; }] },
    "react/jsx-runtime": { jsx: React.createElement, jsxs: React.createElement },
    "react-native": {
      Platform: { OS: os },
      NativeModules: { OrdoExportFile: { saveDocument: async (...args) => {
        saves.push(args);
        if (saveError) throw saveError;
      } } },
      Share: { share: async data => { shares.push(data); return { action: "shared" }; } },
      StyleSheet: { create: value => value },
      View: "View",
    },
    "expo-file-system/legacy": {
      cacheDirectory,
      writeAsStringAsync: async (...args) => { writes.push(args); },
      deleteAsync: async (...args) => { deletes.push(args); },
    },
    "@ordo/shared": { APP_NAME: "ordo" },
    ThemeProvider: { useTheme: () => ({ palette: {} }) },
    tokens: { layout: {}, radius: {}, spacing: {} },
    haptics: { haptics: {
      success: () => feedback.push("success"),
      error: () => feedback.push("error"),
    } },
    "toast-store": { toast: { error: message => feedback.push(message) } },
    "error-message": { errorMessage: (error, fallback) => error.message || fallback },
  };
  for (const name of ["FloatingPanel", "PanelHeader", "Text", "PanelActions"]) {
    services[name === "PanelActions" ? "SheetActionRow" : name] = { [name]: name };
  }
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const filename = resolve(root, file);
    if (!compiled.has(file)) compiled.set(file, transformSync(readFileSync(filename, "utf8"), {
      filename, babelrc: false, configFile: false, presets: ["babel-preset-expo"],
    }).code);
    const module = { exports: {} };
    const localRequire = id => {
      const service = services[id] ?? services[id.split("/").at(-1)];
      if (service) return service;
      if (id.startsWith(".")) {
        const dependency = resolve(filename, "..", id);
        return load(`${dependency}.ts`);
      }
      if (id.startsWith("@babel/runtime/")) return require(id);
      throw new Error(`Unexpected dependency: ${id}`);
    };
    new Function("require", "module", "exports", compiled.get(file))(localRequire, module, module.exports);
    cache.set(file, module.exports);
    return module.exports;
  }
  const helpers = load("lib/backup-codes-file.ts");
  return {
    ...helpers, load, writes, saves, shares, deletes, feedback,
    get saving() { return saving; },
  };
}

test("backup codes save a text file through Android Save As, never the text share sheet", async () => {
  const h = harness();
  await h.downloadBackupCodes(codes);
  assert.equal(h.formatBackupCodesFile(codes), body);
  assert.equal(h.writes.length, 1);
  const [path, contents, options] = h.writes[0];
  assert.equal(contents, body);
  assert.deepEqual(options, { encoding: "utf8" });
  assert.deepEqual(h.saves, [["ordo-backup-codes.txt", "text/plain", path]]);
  assert.deepEqual(h.shares, []);
  assert.deepEqual(h.deletes, [[path, { idempotent: true }]]);
});

test("canceling or failing Save As cleans up plaintext without falling back to sharing", async () => {
  for (const code of ["ERR_EXPORT_CANCELED", "ERR_EXPORT"]) {
    const h = harness({ saveError: Object.assign(new Error("Save failed"), { code }) });
    await assert.rejects(h.downloadBackupCodes(codes), {
      code: code === "ERR_EXPORT_CANCELED" ? "export_save_canceled" : code,
    });
    assert.equal(h.deletes.length, 1);
    assert.deepEqual(h.shares, []);
  }
});

test("missing cache storage fails instead of sharing plaintext codes", async () => {
  const h = harness({ cacheDirectory: null });
  await assert.rejects(h.downloadBackupCodes(codes), /Couldn't write/);
  assert.deepEqual(h.shares, []);
  assert.deepEqual(h.saves, []);
});

test("web still downloads the named backup-code text file", async t => {
  const h = harness({ os: "web" });
  let blob, clicked = false, removed = false;
  const anchor = { click: () => { clicked = true; }, remove: () => { removed = true; } };
  t.mock.method(URL, "createObjectURL", value => { blob = value; return "blob:backup-codes"; });
  const revoke = t.mock.method(URL, "revokeObjectURL", () => {});
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  t.after(() => {
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else delete globalThis.document;
  });
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    createElement: tag => { assert.equal(tag, "a"); return anchor; },
    body: { appendChild: value => assert.equal(value, anchor) },
  } });
  await h.downloadBackupCodes(codes);
  assert.equal(anchor.download, "ordo-backup-codes.txt");
  assert.equal(anchor.href, "blob:backup-codes");
  assert.equal(blob.type, "text/plain;charset=utf-8");
  assert.equal(await blob.text(), body);
  assert.ok(clicked && removed);
  assert.deepEqual(revoke.mock.calls[0].arguments, ["blob:backup-codes"]);
  assert.deepEqual(h.writes, []);
  assert.deepEqual(h.shares, []);
});

test("iOS uses the same file-based Save to Files flow as data exports", async () => {
  const h = harness({ os: "ios" });
  await h.downloadBackupCodes(codes);
  assert.deepEqual(h.shares, [{ url: h.writes[0][0], title: "ordo-backup-codes.txt" }]);
  assert.equal(h.writes[0][1], body);
});

test("the backup-code dialog treats cancellation quietly and remains available to retry", async () => {
  for (const code of [undefined, "ERR_EXPORT_CANCELED", "ERR_EXPORT"]) {
    const h = harness({ saveError: code ? Object.assign(new Error("Save failed"), { code }) : undefined });
    const { BackupCodesDialog } = h.load("components/auth/BackupCodesDialog.tsx");
    let closed = false;
    const render = () => BackupCodesDialog({ codes, onClose: () => { closed = true; } });
    const actions = React.Children.toArray(render().props.children).find(child => child.type === "PanelActions");
    actions.props.onConfirm();
    assert.equal(h.saving, true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.saving, false);
    assert.equal(closed, false);
    assert.equal(render().props.visible, true);
    assert.deepEqual(h.feedback, code === "ERR_EXPORT_CANCELED" ? [] : code ? ["error", "Save failed"] : ["success"]);
  }
});
