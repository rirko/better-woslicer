// Type shim for plain-tsc linting only (tsconfig.lint.json). Product typecheck
// uses vue-tsc, which resolves .vue files natively; ESLint's typed rules run on
// plain tsc and otherwise see .vue imports as unresolved `error` types.
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
  export default component;
}
