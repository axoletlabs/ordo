const { nestEsm } = require("../jest.nest-esm.cjs");

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  rootDir: "..",
  moduleFileExtensions: ["js", "json", "ts"],
  testRegex: ".e2e-spec.ts$",
  ...nestEsm,
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    "^@ordo/shared$": "<rootDir>/../../packages/shared/src/index.ts",
    "^@ordo/shared/(.*)$": "<rootDir>/../../packages/shared/src/$1.ts",
  },
  testTimeout: 30000,
};
