/**
 * Workspace-wide ESLint flat config (ESLint 9). Both the server and mobile
 * `lint` scripts resolve this via ancestor lookup. Uses the non-type-checked
 * typescript-eslint recommended ruleset so no tsconfig project wiring is needed.
 */
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.expo/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/src/generated/**",
      "**/*.config.js",
      "**/expo-env.d.ts",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [...tseslint.configs.recommended],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-empty-function": "off",
    },
  },
);
