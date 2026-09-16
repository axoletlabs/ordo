const { withDangerousMod, withMainApplication } = require("expo/config-plugins");
const { mergeContents } = require("@expo/config-plugins/build/utils/generateCode");
const fs = require("node:fs/promises");
const path = require("node:path");
const { ordoSelectableTextKotlin } = require("./selectable-text-kotlin.js");

/** Expo 57+ Kotlin template mutates PackageList in `.apply { }`, not `return packages`. */
const EXPO57_PACKAGES_APPLY = /PackageList\(this\)\.packages\.apply\s*\{/;

function selectableTextPackageLine(isJava) {
  return isJava
    ? "            packages.add(new OrdoSelectableTextPackage());"
    : "            packages.add(OrdoSelectableTextPackage())";
}

function selectableTextApplyLine(isJava) {
  return isJava
    ? "          add(new OrdoSelectableTextPackage());"
    : "          add(OrdoSelectableTextPackage())";
}

function patchMainApplicationForSelectableText(contents, language) {
  const isJava = language === "java";
  if (EXPO57_PACKAGES_APPLY.test(contents)) {
    return mergeContents({
      src: contents,
      tag: "ordo-selectable-text-package",
      comment: "          //",
      offset: 1,
      anchor: EXPO57_PACKAGES_APPLY,
      newSrc: selectableTextApplyLine(isJava),
    }).contents;
  }
  return mergeContents({
    src: contents,
    tag: "ordo-selectable-text-package",
    comment: "            //",
    offset: 0,
    anchor: /return packages/,
    newSrc: selectableTextPackageLine(isJava),
  }).contents;
}

function withSelectableText(config) {
  config = withDangerousMod(config, [
    "android",
    async (mod) => {
      const packageName = mod.android?.package;
      if (!packageName) throw new Error("Android package name is required");
      const sourceDir = path.join(
        mod.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "java",
        ...packageName.split("."),
      );
      await fs.mkdir(sourceDir, { recursive: true });
      await fs.writeFile(
        path.join(sourceDir, "OrdoSelectableTextModule.kt"),
        ordoSelectableTextKotlin(packageName),
      );
      return mod;
    },
  ]);

  config = withMainApplication(config, (mod) => {
    mod.modResults.contents = patchMainApplicationForSelectableText(
      mod.modResults.contents,
      mod.modResults.language,
    );
    return mod;
  });

  return config;
}

module.exports = withSelectableText;
module.exports.patchMainApplicationForSelectableText = patchMainApplicationForSelectableText;
module.exports.ordoSelectableTextKotlin = ordoSelectableTextKotlin;
