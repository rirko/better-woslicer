import { isTauri } from '@tauri-apps/api/core';
import { createBrowserPlatform, getBrowserBuildIdentity } from './browser';
import { createTauriPlatform, getTauriBuildIdentity } from './tauri';
import type { BuildIdentity, Platform } from './contracts';

export const platform: Platform = isTauri() ? createTauriPlatform() : createBrowserPlatform();
export function getPlatform(): Platform {
  return platform;
}

function parseBuildIdentity(value: unknown): BuildIdentity {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('name' in value) ||
    typeof value.name !== 'string' ||
    !value.name ||
    !('version' in value) ||
    typeof value.version !== 'string' ||
    !/^\d+\.\d+\.\d+(?:-[\da-z.-]+)?(?:\+[\da-z.-]+)?$/i.test(value.version) ||
    !('commit' in value) ||
    typeof value.commit !== 'string' ||
    !/^[\da-f]{40,64}$/.test(value.commit) ||
    !('dirty' in value) ||
    typeof value.dirty !== 'boolean' ||
    !('builtAt' in value) ||
    typeof value.builtAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(value.builtAt) ||
    !Number.isFinite(Date.parse(value.builtAt)) ||
    !('repositoryUrl' in value) ||
    (value.repositoryUrl !== null &&
      (typeof value.repositoryUrl !== 'string' ||
        !/^https:\/\/github\.com\/[\w-]+\/[\w.-]+$/.test(value.repositoryUrl)))
  ) {
    throw new Error('Invalid local build identity');
  }
  return {
    name: value.name,
    version: value.version,
    commit: value.commit,
    dirty: value.dirty,
    builtAt: value.builtAt,
    repositoryUrl: value.repositoryUrl,
  };
}

export async function getBuildIdentity(): Promise<BuildIdentity> {
  return parseBuildIdentity(
    await (platform.kind === 'tauri' ? getTauriBuildIdentity() : getBrowserBuildIdentity()),
  );
}
