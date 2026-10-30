"use strict";

const assert = require("node:assert/strict");
const { androidBuildNumber } = require("./release-policy");

const tags = ["v0.3.0-preview.6", "v0.2.0", "v0.1.0", "v0.3.0"];
assert.equal(androidBuildNumber("0.1.0", tags), 1);
assert.equal(androidBuildNumber("0.2.0", tags), 2);
assert.equal(androidBuildNumber("0.3.0", tags), 3);
assert.equal(androidBuildNumber("0.3.1", tags), 4);
assert.equal(androidBuildNumber("0.4.0", [...tags, "v0.3.1"]), 5);
assert.equal(androidBuildNumber("0.2.1", tags), null);
assert.equal(androidBuildNumber("0.3.0", ["v0.2.0"]), null);
assert.equal(androidBuildNumber("0.3.0", null), null);
assert.equal(androidBuildNumber("0.3.0-preview.6", tags), 8);
assert.equal(androidBuildNumber("0.2.0-preview.2", tags), 2);
console.log("Stable and Preview build number checks passed.");
