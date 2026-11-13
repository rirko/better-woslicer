import { readFileSync } from 'node:fs';

function releaseSection(changelog, version, language) {
  const lines = changelog.replace(/\r\n/g, '\n').split('\n');
  const headings = lines.flatMap((line, index) =>
    line === `## ${version}` || line.startsWith(`## ${version} — `) ? [index] : [],
  );
  if (headings.length !== 1) throw new Error(`Expected one ${version} release in ${language}`);
  const start = headings[0] + 1;
  const next = lines.findIndex((line, index) => index >= start && line.startsWith('## '));
  const body = lines
    .slice(start, next === -1 ? undefined : next)
    .join('\n')
    .trim();
  if (!body) throw new Error(`The ${version} release is empty in ${language}`);
  return body;
}

export function releaseNotes(version, english, chinese) {
  return `## English\n\n${releaseSection(english, version, 'CHANGELOG.md')}\n\n## 中文\n\n${releaseSection(chinese, version, 'CHANGELOG.zh-CN.md')}\n`;
}

if (import.meta.main) {
  const root = new URL('../', import.meta.url);
  const { version } = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  const read = (name) => readFileSync(new URL(name, root), 'utf8');
  process.stdout.write(releaseNotes(version, read('CHANGELOG.md'), read('CHANGELOG.zh-CN.md')));
}
