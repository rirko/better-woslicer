import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const targets = {
  web: 'web',
  'windows-x64': 'x86_64-pc-windows-msvc',
  'windows-arm64': 'aarch64-pc-windows-msvc',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'macos-arm64': 'aarch64-apple-darwin',
  'macos-x64': 'x86_64-apple-darwin',
};

const manifestName = (platform) => `manifest-${platform}.json`;
const artifactName = (platform, commit) => `woslicer-${platform}-release-${commit}`;
const json = (file) => JSON.parse(readFileSync(file, 'utf8'));

function checksum(directory, name) {
  if (typeof name !== 'string' || !/^[\w.+-]+$/.test(name)) {
    throw new Error(`Invalid artifact file name: ${name}`);
  }
  const file = join(directory, name);
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.size === 0) {
    throw new Error(`Missing or empty artifact: ${name}`);
  }
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

export function recordManifest(directory, platform, identity) {
  if (!Object.hasOwn(targets, platform)) throw new Error(`Unknown platform: ${platform}`);
  const files = readdirSync(directory).filter((name) => name !== manifestName(platform));
  if (files.length === 0) throw new Error(`No packages for ${platform}`);
  const manifest = {
    ...identity,
    platform,
    target: targets[platform],
    files: files.map((name) => ({ name, sha256: checksum(directory, name) })),
  };
  writeFileSync(join(directory, manifestName(platform)), `${JSON.stringify(manifest, null, 2)}\n`);
}

export function verifyManifests(directory, expected, platforms = Object.keys(targets)) {
  const claimed = new Set();
  for (const platform of platforms) {
    const name = manifestName(platform);
    const manifest = json(join(directory, name));
    for (const [key, value] of Object.entries({
      ...expected,
      profile: 'release',
      dirty: false,
      platform,
      target: targets[platform],
    })) {
      if (manifest[key] !== value) throw new Error(`${platform}: unexpected ${key}`);
    }
    if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
      throw new Error(`${platform}: no package checksums`);
    }
    claimed.add(name);
    for (const file of manifest.files) {
      if (claimed.has(file.name)) throw new Error(`Duplicate artifact: ${file.name}`);
      if (checksum(directory, file.name) !== file.sha256) {
        throw new Error(`Checksum mismatch: ${file.name}`);
      }
      claimed.add(file.name);
    }
  }
  if (readdirSync(directory).some((name) => !claimed.has(name))) {
    throw new Error('Unexpected files in downloaded artifacts');
  }
}

export function selectSourceRun(runs, commit) {
  const run = runs
    .filter(
      (item) =>
        item.head_sha === commit &&
        item.head_branch === 'main' &&
        item.path === '.github/workflows/build.yml' &&
        ['push', 'workflow_dispatch'].includes(item.event),
    )
    .sort((a, b) => b.id - a.id)[0];
  if (!run)
    throw new Error('No main build for this commit. Run Build and test on main before tagging.');
  // Select before checking success: a failed latest run must not expose older packages.
  return run;
}

// Check job results too, even if a future workflow permits individual job failures.
export function validateSourceRun(run, jobs, artifacts, commit) {
  if (
    run.head_sha !== commit ||
    run.head_branch !== 'main' ||
    !['push', 'workflow_dispatch'].includes(run.event) ||
    run.status !== 'completed' ||
    run.conclusion !== 'success' ||
    run.path !== '.github/workflows/build.yml'
  )
    throw new Error('Expected a successful main build at the exact tag commit');
  if (jobs.length === 0 || jobs.some((job) => job.conclusion !== 'success')) {
    throw new Error('Every main build job must succeed before publication');
  }
  const selected = {};
  for (const platform of Object.keys(targets)) {
    const matches = artifacts.filter(
      (artifact) => artifact.name === artifactName(platform, commit),
    );
    if (matches.length !== 1 || matches[0].expired || matches[0].size_in_bytes <= 0) {
      throw new Error(`Missing, expired or ambiguous release artifact: ${platform}`);
    }
    selected[platform] = matches[0];
  }
  return selected;
}

function api(endpoint) {
  return JSON.parse(execFileSync('gh', ['api', endpoint], { encoding: 'utf8', windowsHide: true }));
}

function pages(endpoint, key) {
  const items = [];
  for (let page = 1; ; page++) {
    const data = api(`${endpoint}${endpoint.includes('?') ? '&' : '?'}per_page=100&page=${page}`)[
      key
    ];
    if (!Array.isArray(data)) throw new Error(`Invalid GitHub response: ${key}`);
    items.push(...data);
    if (data.length < 100) return items;
  }
}

function resolveRun(commit) {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '') || !/^[a-f0-9]{40}$/.test(commit)) {
    throw new Error('Expected a GitHub repository and full commit');
  }
  const base = `repos/${repo}/actions`;
  const runs = pages(
    `${base}/workflows/build.yml/runs?branch=main&head_sha=${commit}`,
    'workflow_runs',
  );
  const run = selectSourceRun(runs, commit);
  const jobs = pages(`${base}/runs/${run.id}/jobs?filter=latest`, 'jobs');
  const artifacts = pages(`${base}/runs/${run.id}/artifacts`, 'artifacts');
  const selected = validateSourceRun(run, jobs, artifacts, commit);
  const output = {
    'run-id': run.id,
    'run-attempt': run.run_attempt,
    'artifact-ids': Object.values(selected)
      .map((artifact) => artifact.id)
      .join(','),
    'web-artifact-id': selected.web.id,
  };
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    Object.entries(output)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(''),
  );
  console.log(`Using main build ${run.html_url}`);
}

if (import.meta.main) {
  const [command, directory, platform] = process.argv.slice(2);
  const pkg = json('package.json');
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (command === 'resolve') {
    if (process.env.GITHUB_REF_NAME !== `v${pkg.version}`)
      throw new Error('Tag does not match package version');
    resolveRun(commit);
  } else if (command === 'record') {
    const info = json('src-tauri/generated/build-info.json');
    if (info.commit !== commit || info.version !== pkg.version || info.dirty !== false) {
      throw new Error('Artifacts require a clean, current build identity');
    }
    recordManifest(directory, platform, {
      name: pkg.name,
      version: pkg.version,
      commit,
      dirty: info.dirty,
      profile: process.env.WOSLICER_BUILD_PROFILE,
      runId: process.env.GITHUB_RUN_ID,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    });
  } else if (command === 'verify') {
    if (!process.env.SOURCE_RUN_ID || !process.env.SOURCE_RUN_ATTEMPT)
      throw new Error('Missing source run identity');
    verifyManifests(
      directory,
      {
        name: pkg.name,
        version: pkg.version,
        commit,
        runId: process.env.SOURCE_RUN_ID,
        runAttempt: process.env.SOURCE_RUN_ATTEMPT,
      },
      platform ? [platform] : undefined,
    );
  } else throw new Error('Expected resolve, record or verify');
}
