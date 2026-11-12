// pre-commit checks only; tasks must never rewrite, fix, or git add staged
// content (docs/refactoring/LINT_FORMAT_PLAN.md §3). The --concurrency 1 flag
// on the lint:staged script keeps every group and task strictly serial.
export default {
  // Staged code is linted, then checked against the committed formatter state.
  '*.{ts,tsx,mts,cts,js,mjs,cjs,vue}': ['eslint --max-warnings 0', 'oxfmt --check'],
  // Other managed text (css/html/json/yml) is formatter-owned; format check only.
  '*.{css,html,json,jsonc,yml,yaml}': ['oxfmt --check'],
  // Any staged tool configuration widens the check to the full managed scope:
  // scripts/check-staged-quality.mjs ignores the file list and runs the full
  // `lint` + `fmt:check` commands, exiting with their status.
  '{eslint.config.mjs,.oxfmtrc.json,tsconfig.json,tsconfig.app.json,tsconfig.tests.json,tsconfig.lint.json,tsconfig.lint.shims.d.ts,package.json,package-lock.json,vite.config.mts,vitest.config.mts,playwright.app.config.mts}':
    ['node scripts/check-staged-quality.mjs'],
};
