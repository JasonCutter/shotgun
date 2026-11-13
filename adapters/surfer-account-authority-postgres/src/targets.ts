import { surferFailure } from '../../../packages/contracts/src/surfer-learning.js';
export function assertSurferAccountDatabaseTargets(workload: string, authority: string) {
  const target = (value: string) => {
    if (typeof value !== 'string') throw surferFailure('Invalid account authority target.');
    let u: URL;
    try {
      u = new URL(value);
    } catch {
      throw surferFailure('Invalid account authority target.');
    }
    if (
      !['postgres:', 'postgresql:'].includes(u.protocol) ||
      !u.hostname ||
      !u.pathname.replace(/^\//, '')
    )
      throw surferFailure('Invalid account authority target.');
    for (const k of u.searchParams.keys())
      if (['host', 'port', 'database', 'dbname', 'db', 'service'].includes(k.toLowerCase()))
        throw surferFailure('Ambiguous account authority target.');
    const host = ['localhost', '127.0.0.1', '[::1]'].includes(
      decodeURIComponent(u.hostname).toLowerCase(),
    )
      ? 'loopback'
      : decodeURIComponent(u.hostname).toLowerCase();
    return [host, u.port || '5432', decodeURIComponent(u.pathname)].join('|');
  };
  if (target(workload) === target(authority))
    throw surferFailure('Workload database cannot be its account authority.');
  return { authorityDatabaseName: decodeURIComponent(new URL(authority).pathname.slice(1)) };
}
