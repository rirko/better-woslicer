import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import {
  recordManifest,
  selectSourceRun,
  targets,
  validateSourceRun,
  verifyManifests,
} from './release-artifacts.mjs';

const commit = 'a'.repeat(40);
const identity = {
  name: 'woslicer-dx',
  version: '1.0.1',
  commit,
  dirty: false,
  profile: 'release',
  runId: '123',
  runAttempt: '1',
};

function packages(t) {
  const prefix = resolve(tmpdir(), 'woslicer-artifacts-');
  const directory = mkdtempSync(prefix);
  t.after(() => {
    assert.ok(resolve(directory).startsWith(prefix));
    rmSync(directory, { recursive: true, force: true });
  });
  writeFileSync(join(directory, 'web.zip'), 'tested package bytes');
  recordManifest(directory, 'web', identity);
  return directory;
}

test('promotion verifies the bytes and identity from the selected run', (t) => {
  const directory = packages(t);
  verifyManifests(directory, identity, ['web']);
  writeFileSync(join(directory, 'web.zip'), 'different package bytes');
  assert.throws(() => verifyManifests(directory, identity, ['web']), /Checksum mismatch/);
});

test('promotion rejects debug, dirty, stale and mixed-attempt packages', (t) => {
  const directory = packages(t);
  const file = join(directory, 'manifest-web.json');
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  for (const [key, value] of Object.entries({
    profile: 'debug',
    dirty: true,
    commit: 'b'.repeat(40),
    version: '0.9.0',
    runId: '122',
    runAttempt: '2',
    target: 'wrong-target',
  })) {
    writeFileSync(file, JSON.stringify({ ...manifest, [key]: value }));
    assert.throws(() => verifyManifests(directory, identity, ['web']), /unexpected/);
  }
});

test('promotion rejects missing platforms, path traversal and extra files', (t) => {
  const directory = packages(t);
  assert.throws(() => verifyManifests(directory, identity), /ENOENT/);
  writeFileSync(join(directory, 'extra.zip'), 'unverified');
  assert.throws(() => verifyManifests(directory, identity, ['web']), /Unexpected files/);
  const file = join(directory, 'manifest-web.json');
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  manifest.files[0].name = '../web.zip';
  writeFileSync(file, JSON.stringify(manifest));
  assert.throws(() => verifyManifests(directory, identity, ['web']), /Invalid artifact file name/);
});

function source() {
  return {
    run: {
      id: 100,
      head_sha: commit,
      head_branch: 'main',
      event: 'push',
      status: 'completed',
      conclusion: 'success',
      path: '.github/workflows/build.yml',
    },
    jobs: [{ conclusion: 'success' }],
    artifacts: Object.keys(targets).map((platform, index) => ({
      id: index + 1,
      name: `woslicer-${platform}-release-${commit}`,
      expired: false,
      size_in_bytes: 100,
    })),
  };
}

test('source selection accepts all platforms only from a successful exact-commit main build', () => {
  const { run, jobs, artifacts } = source();
  const selected = validateSourceRun(run, jobs, artifacts.toReversed(), commit);
  assert.equal(Object.keys(selected).length, 7);
  assert.equal(selected.web.id, 1);
  for (const change of [
    { head_sha: 'b'.repeat(40) },
    { head_branch: 'dev' },
    { event: 'pull_request' },
    { conclusion: 'failure' },
    { status: 'in_progress' },
    { path: 'other.yml' },
  ]) {
    assert.throws(
      () => validateSourceRun({ ...run, ...change }, jobs, artifacts, commit),
      /successful main build/,
    );
  }
});

test('workflow success cannot hide a failed or skipped platform job', () => {
  const { run, artifacts } = source();
  for (const conclusion of ['failure', 'cancelled', 'skipped', null]) {
    assert.throws(
      () => validateSourceRun(run, [{ conclusion }], artifacts, commit),
      /Every main build job/,
    );
  }
  assert.throws(() => validateSourceRun(run, [], artifacts, commit), /Every main build job/);
});

test('latest failed or incomplete main run blocks fallback to an older successful run', () => {
  const { run, jobs, artifacts } = source();
  for (const state of [
    { status: 'completed', conclusion: 'failure' },
    { status: 'in_progress', conclusion: null },
  ]) {
    const latest = { ...run, id: 101, ...state };
    const selected = selectSourceRun([latest, run], commit);
    assert.equal(selected.id, latest.id);
    assert.throws(
      () => validateSourceRun(selected, jobs, artifacts, commit),
      /successful main build/,
    );
  }
});

test('source selection ignores other commits, branches, workflows and pull request runs', () => {
  const { run } = source();
  const unrelated = [
    { ...run, id: 101, head_sha: 'b'.repeat(40) },
    { ...run, id: 102, head_branch: 'dev' },
    { ...run, id: 103, event: 'pull_request' },
    { ...run, id: 104, path: '.github/workflows/release.yml' },
  ];
  assert.equal(selectSourceRun([...unrelated, run], commit).id, run.id);
  assert.throws(() => selectSourceRun(unrelated, commit), /No main build/);
  const manual = { ...run, id: 105, event: 'workflow_dispatch' };
  assert.equal(selectSourceRun([run, manual], commit).id, manual.id);
});

test('source selection rejects expired, missing, duplicate and debug-only artifacts', () => {
  const { run, jobs, artifacts } = source();
  for (const changed of [
    artifacts.slice(1),
    [...artifacts, artifacts[0]],
    artifacts.map((artifact) => ({ ...artifact, expired: true })),
    artifacts.map((artifact) => ({
      ...artifact,
      name: artifact.name.replace('-release-', '-debug-'),
    })),
  ]) {
    assert.throws(
      () => validateSourceRun(run, jobs, changed, commit),
      /Missing, expired or ambiguous/,
    );
  }
});
