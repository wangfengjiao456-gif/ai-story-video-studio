import globals from "globals";
export default [
  { ignores: ["node_modules/**", "dist/**", "work/**", "public/**"] },
  {
    files: [
      "src/**/*.{js,jsx}",
      "api/**/*.js",
      "scripts/**/*.mjs",
      "tests/**/*.js",
      "eslint.config.js",
    ],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      "no-undef": "error",
      "no-unreachable": "error",
      "no-dupe-args": "error",
      "no-dupe-keys": "error",
      "no-duplicate-case": "error",
      "no-unsafe-finally": "error",
      "no-constant-binary-expression": "error",
      "valid-typeof": "error",
    },
  },
  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["api/**/*.js", "scripts/**/*.mjs", "eslint.config.js"],
    languageOptions: { globals: globals.node },
  },
  {
    files: [
      "tests/**/*.js",
      "scripts/browser-video-regression.mjs",
      "scripts/browser-creation-v4.mjs",
    ],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
];
