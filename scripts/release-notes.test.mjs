import assert from 'node:assert/strict';
import { test } from 'node:test';
import { releaseNotes } from './release-notes.mjs';

test('release notes contain only the requested version in both languages', () => {
  const english =
    '# Changelog\n\n## Unreleased\n\n- Future.\n\n## 1.0.0 — 2026-11-13\n\n### Added\n\n- Open projects.\n\n## 0.3.0\n\n- Old change.\n';
  const chinese =
    '# 变更日志\r\n\r\n## 1.0.0 — 2026-11-13\r\n\r\n### 修复\r\n\r\n- 正确保存名称。\r\n';
  assert.equal(
    releaseNotes('1.0.0', english, chinese),
    '## English\n\n### Added\n\n- Open projects.\n\n## 中文\n\n### 修复\n\n- 正确保存名称。\n',
  );
});

test('missing, duplicate and empty release entries stop note generation', () => {
  const valid = '## 1.0.0\n\n- User-visible change.\n';
  for (const invalid of [
    '## 1.0.01\n- Wrong version.',
    '## Unreleased\n- Future.',
    '## 1.0.0\n\n## 0.3.0\n- Old.',
    valid + valid,
  ]) {
    assert.throws(() => releaseNotes('1.0.0', invalid, valid));
    assert.throws(() => releaseNotes('1.0.0', valid, invalid));
  }
});
