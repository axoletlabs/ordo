const swcJest = {
  jsc: {
    parser: { syntax: "typescript", decorators: true, dynamicImport: true },
    transform: { legacyDecorator: true, decoratorMetadata: true },
    target: "es2022",
    keepClassNames: true,
  },
  module: { type: "commonjs" },
};

/** Shared Jest bits so unit and e2e both transpile Nest 12's ESM packages to CJS. */
const nestEsm = {
  transform: {
    "^.+\\.(t|j)s$": ["@swc/jest", swcJest],
  },
  // Nest 12 (+ file-type, Standard Schema) ship ESM. SWC rewrites import.meta
  // for CJS. The `.*` lets pnpm's `.pnpm/@nestjs+common@…` realpaths through.
  transformIgnorePatterns: [
    "/node_modules/(?!.*(@nestjs/|@standard-schema/|file-type/|token-types/|strtok3/|peek-readable/|@tokenizer/|uint8array-extras/|load-esm/))",
  ],
};

module.exports = { nestEsm, swcJest };
