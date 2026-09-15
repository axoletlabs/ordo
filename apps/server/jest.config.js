const { nestEsm } = require("./jest.nest-esm.cjs");

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  rootDir: ".",
  moduleFileExtensions: ["js", "json", "ts"],
  testRegex: ".*\\.spec\\.ts$",
  ...nestEsm,
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    "^@ordo/shared$": "<rootDir>/../../packages/shared/src/index.ts",
    "^@ordo/shared/(.*)$": "<rootDir>/../../packages/shared/src/$1.ts",
  },
  collectCoverageFrom: ["src/**/*.ts", "!src/main.ts", "!src/**/*/module.ts"],
  coverageDirectory: "./coverage",
  testTimeout: 20000,
};
