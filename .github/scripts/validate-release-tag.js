#!/usr/bin/env node
"use strict";
const {
  resolveUpdatesChannel, releaseLineBranch, validateReleaseBranch, validateReleaseTag,
} = require("../../scripts/release-policy.js");

const [command, ...args] = process.argv.slice(2);
let error;
if (command === "--release-branch") {
  error = validateReleaseBranch(args[0], args[1]);
  if (!error) console.log(releaseLineBranch(args[0]));
} else if (command === "--channel") {
  const channel = resolveUpdatesChannel(args[0], args[1] === "--branch" ? args[2] : null);
  if (channel) console.log(channel);
  else error = `Cannot map app version '${args[0] ?? ""}' and branch '${args[2] ?? ""}' to an EAS channel`;
} else if (command && args.length === 2 && ["true", "false"].includes(args[1])) {
  error = validateReleaseTag(command, args[0], args[1] === "true");
} else {
  error = "Usage: validate-release-tag.js <tag> <appVersion> <true|false> | --channel <appVersion> [--branch <branch>] | --release-branch <tag> <targetBranch>";
}
if (error) {
  console.error(`::error::${error}`);
  process.exit(1);
}
