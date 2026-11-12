// @ts-check
// Lint/fmt tool contract: docs/refactoring/LINT_FORMAT_PLAN.md
// ESLint checks semantics only; Oxfmt owns formatting (eslint-config-prettier turns off stylistic rules, loaded last).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import pluginVue from 'eslint-plugin-vue';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    // Managed lint scope is src/ + tests/ + scripts/ + root tool configs.
    // Excluded paths stay excluded even when passed explicitly on the CLI.
    name: 'woslicer/excludes',
    ignores: [
      '.git/**',
      'node_modules/**',
      'dist/**',
      'release/**',
      'src-tauri/target/**',
      'src-tauri/generated/**',
      'src/i18n/generated.ts',
      '.pending-delete/**',
      '.smell-check/**',
      'test-artifacts/**',
      'test-results/**',
      'playwright-report/**',
      'screenshots/**',
    ],
  },

  // Base JS recommendation (no type info; applies to .js/.mjs/.cjs and, via later blocks, TS/Vue).
  js.configs.recommended,

  // TS recommendation with type-aware rules. The preset applies its typed-rule
  // block to every linted file, but JS/MJS/CJS intentionally run without type
  // info (they have no tsconfig project), so scope that block to TS-family files.
  ...tseslint.configs.recommendedTypeChecked.map((config) =>
    config.name === 'typescript-eslint/recommended-type-checked'
      ? { ...config, files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts', '**/*.vue'] }
      : config,
  ),

  // Vue SFC template + script checks.
  ...pluginVue.configs['flat/recommended'],

  {
    // Type-aware rules need project info for TS sources and tests. Root TS tool
    // configs and component tests are NOT covered by tsconfig.app/tests, so a
    // dedicated tsconfig.lint.json lists them explicitly.
    name: 'woslicer/typed-project',
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts', '**/*.vue'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.lint.json',
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.vue'],
      },
    },
  },

  {
    // Inside .vue files the top-level parser stays vue-eslint-parser; the TS
    // parser handles the <script> block so typed rules cover SFC scripts too.
    name: 'woslicer/vue-typed-script',
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },

  {
    name: 'woslicer/browser-globals',
    files: ['src/**'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },

  {
    name: 'woslicer/node-globals',
    files: ['scripts/**/*.{js,mjs,cjs}', '*.{js,mjs,cjs}', '*.mts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  {
    // Repository requirements beyond the presets (AGENTS.md: no any, no `!`,
    // exhaustive switches). Stylistic/formatting rules are intentionally absent.
    // Scoped to TS-family files: JS/MJS/CJS run without type information.
    name: 'woslicer/rules',
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts', '**/*.vue'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
    },
  },

  // Must stay last: disables rules that conflict with the formatter.
  eslintConfigPrettier,
);
