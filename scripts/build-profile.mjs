/**
 * Select one profile for frontend output, native builds and executable probes.
 * Explicit flags override the environment; everything else defaults to debug.
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ profile: 'debug' | 'release', args: string[] }}
 */
export function resolveBuildProfile(args = [], env = process.env) {
  const separator = args.indexOf('--');
  const options = separator < 0 ? args : args.slice(0, separator);
  const trailing = separator < 0 ? [] : args.slice(separator);
  const debug = options.includes('--debug') || options.includes('-d');
  const release = options.includes('--release');
  if (debug && release) throw new Error('Choose either --debug or --release, not both');
  const profile = debug ? 'debug' : release ? 'release' : (env.WOSLICER_BUILD_PROFILE ?? 'debug');
  if (profile !== 'debug' && profile !== 'release') {
    throw new Error('WOSLICER_BUILD_PROFILE must be debug or release');
  }
  return {
    profile,
    args: [...options.filter((arg) => !['--debug', '-d', '--release'].includes(arg)), ...trailing],
  };
}
