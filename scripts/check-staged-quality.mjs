// lint-staged task: a staged tool configuration (lint/fmt config, tsconfig,
// package.json/lockfile, runner config) invalidates file-level checks, so the
// full managed-scope commands run instead. Read-only: never fixes or stages.
import { spawnSync } from 'node:child_process';

const tasks = [
  { name: 'lint', command: 'npm', args: ['run', 'lint'] },
  { name: 'fmt:check', command: 'npm', args: ['run', 'fmt:check'] },
];

for (const task of tasks) {
  console.log(`[check-staged-quality] running full ${task.name}...`);
  const started = Date.now();
  const result = spawnSync(task.command, task.args, { stdio: 'inherit', shell: true });
  if (result.status !== 0 || result.error) {
    console.error(`[check-staged-quality] full ${task.name} failed; commit blocked.`);
    process.exit(result.status ?? 1);
  }
  console.log(`[check-staged-quality] full ${task.name} passed in ${Date.now() - started}ms`);
}
