import assert from 'node:assert/strict';
import { test } from 'node:test';
import { repositoryUrl } from './repository-url.mjs';

test('CI derives the project link from the current repository, including forks', () => {
  assert.equal(
    repositoryUrl({
      GITHUB_ACTIONS: 'true',
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_REPOSITORY: 'fork-owner/new-name',
    }),
    'https://github.com/fork-owner/new-name',
  );
  assert.throws(() =>
    repositoryUrl({
      GITHUB_ACTIONS: 'true',
      GITHUB_SERVER_URL: 'https://example.org',
      GITHUB_REPOSITORY: 'owner/repo',
    }),
  );
  assert.throws(() =>
    repositoryUrl({
      GITHUB_ACTIONS: 'true',
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_REPOSITORY: 'owner/repo?redirect=bad',
    }),
  );
});

test('local builds recognize standard GitHub remotes without resolving SSH aliases', () => {
  for (const remote of [
    'https://github.com/owner/repo.git',
    'git@github.com:owner/repo.git',
    'ssh://git@github.com/owner/repo.git',
  ]) {
    assert.equal(repositoryUrl({}, remote), 'https://github.com/owner/repo');
  }
  for (const remote of [
    '',
    'msgit:owner/repo',
    'file:///local/repo',
    'https://github.com.evil/owner/repo',
  ]) {
    assert.equal(repositoryUrl({}, remote), null);
  }
});
