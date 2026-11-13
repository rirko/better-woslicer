// CI supplies the repository identity. Local builds recognize standard GitHub remotes only.
export function repositoryUrl(env, origin = '') {
  if (env.GITHUB_ACTIONS === 'true') {
    if (
      env.GITHUB_SERVER_URL !== 'https://github.com' ||
      !/^[\w-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY ?? '')
    ) {
      throw new Error('GitHub CI must provide a valid repository identity');
    }
    return `https://github.com/${env.GITHUB_REPOSITORY}`;
  }
  const match =
    /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(
      origin,
    );
  return match ? `https://github.com/${match[1]}` : null;
}
