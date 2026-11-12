import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { resolveBuildProfile } from './build-profile.mjs';

test('local commands default to debug and can explicitly select release', () => {
  assert.equal(resolveBuildProfile([], {}).profile, 'debug');
  assert.equal(resolveBuildProfile(['--release'], {}).profile, 'release');
});

test('explicit profile flags override the inherited profile', () => {
  assert.equal(
    resolveBuildProfile(['--debug'], { WOSLICER_BUILD_PROFILE: 'release' }).profile,
    'debug',
  );
  assert.equal(
    resolveBuildProfile(['--release'], { WOSLICER_BUILD_PROFILE: 'debug' }).profile,
    'release',
  );
  assert.equal(resolveBuildProfile([], { WOSLICER_BUILD_PROFILE: 'release' }).profile, 'release');
});

test('invalid or conflicting profiles fail before starting a build', () => {
  assert.throws(() => resolveBuildProfile(['--debug', '--release'], {}), /either/);
  assert.throws(() => resolveBuildProfile([], { WOSLICER_BUILD_PROFILE: 'typo' }), /must be/);
});

test('CI rejects debug and requires an explicit release selection', () => {
  assert.throws(() => resolveBuildProfile([], { GITHUB_ACTIONS: 'true' }), /release profile/);
  assert.throws(
    () =>
      resolveBuildProfile(['--debug'], {
        GITHUB_ACTIONS: 'true',
        WOSLICER_BUILD_PROFILE: 'release',
      }),
    /release profile/,
  );
  assert.equal(
    resolveBuildProfile([], { GITHUB_ACTIONS: 'true', WOSLICER_BUILD_PROFILE: 'release' }).profile,
    'release',
  );
});

test('Tauri options and Cargo arguments survive profile selection', () => {
  assert.deepEqual(
    resolveBuildProfile(['--release', '--target', 'x86_64-pc-windows-msvc', '--', '--locked'], {}),
    {
      profile: 'release',
      args: ['--target', 'x86_64-pc-windows-msvc', '--', '--locked'],
    },
  );
});

for (const profile of ['debug', 'release']) {
  test(`Tauri wrapper accepts ${profile} and delegates to the real CLI`, () => {
    const result = spawnSync(
      process.execPath,
      ['scripts/tauri.mjs', 'build', `--${profile}`, '--help'],
      {
        encoding: 'utf8',
        env: { ...process.env, GITHUB_ACTIONS: 'false' },
        timeout: 15_000,
        windowsHide: true,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`Tauri build: ${profile}`));
    assert.match(result.stdout, /--debug/);
  });
}
