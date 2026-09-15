import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createDefaultCanonicalLaunchDeps,
  LAUNCHER_ID,
  runCanonicalLaunchPreflight,
  type CanonicalLaunchDeps,
  type GitCommandResult,
  type LauncherRuntimeIdentity,
} from '../../scripts/launch-canonical.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const makeRoot = async (prefix: string): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
};

const runGit = (cwd: string, args: readonly string[]): void => {
  execFileSync('git', [...args], { cwd, stdio: 'ignore' });
};

const readGit = (cwd: string, args: readonly string[]): string =>
  execFileSync('git', [...args], { cwd, encoding: 'utf8' }).trim();

const createRepositoryFixture = async (): Promise<{
  readonly root: string;
  readonly origin: string;
  readonly seed: string;
  readonly work: string;
  readonly initialSha: string;
}> => {
  const root = await makeRoot('shotgun-launch-git-');
  const origin = path.join(root, 'origin.git');
  const seed = path.join(root, 'seed');
  const work = path.join(root, 'work');
  await mkdir(origin, { recursive: true });
  await mkdir(seed, { recursive: true });
  runGit(origin, ['init', '--bare', '--initial-branch=main']);
  runGit(seed, ['init', '--initial-branch=main']);
  runGit(seed, ['config', 'user.email', 'launcher-test@example.com']);
  runGit(seed, ['config', 'user.name', 'Launcher Test']);
  await writeFile(path.join(seed, 'README.md'), 'initial\n', 'utf8');
  runGit(seed, ['add', 'README.md']);
  runGit(seed, ['commit', '-m', 'initial']);
  runGit(seed, ['remote', 'add', 'origin', origin]);
  runGit(seed, ['push', '-u', 'origin', 'main']);
  runGit(root, ['clone', origin, work]);
  const initialSha = readGit(work, ['rev-parse', 'HEAD']);
  return { root, origin, seed, work, initialSha };
};

const commitAndPushSeed = async (
  fixture: Awaited<ReturnType<typeof createRepositoryFixture>>,
  value: string,
) => {
  await writeFile(path.join(fixture.seed, 'README.md'), `${value}\n`, 'utf8');
  runGit(fixture.seed, ['add', 'README.md']);
  runGit(fixture.seed, ['commit', '-m', value]);
  runGit(fixture.seed, ['push', 'origin', 'main']);
};

const makeOptions = (rootDirectory: string) => ({
  rootDirectory,
  host: '127.0.0.1',
  port: 3300,
  reexecCount: 0,
});

const makeFakeDeps = (rootDirectory: string, overrides: Partial<CanonicalLaunchDeps> = {}) => {
  const canonicalRoot = path.resolve(rootDirectory);
  const records = new Map<string, unknown>();
  const remoteSha = '2222222222222222222222222222222222222222';
  const localSha = remoteSha;
  const runGitCalls: string[] = [];
  const result = (status: number, stdout = ''): GitCommandResult => ({
    status,
    stdout,
    stderr: status === 0 ? '' : 'failure',
  });
  const runGit = vi.fn((_cwd: string, args: readonly string[]): GitCommandResult => {
    const command = args.join(' ');
    runGitCalls.push(command);
    if (command === 'branch --show-current') return result(0, 'main\n');
    if (command === 'status --porcelain=v1 --untracked-files=all') return result(0);
    if (command === 'rev-parse HEAD') return result(0, `${localSha}\n`);
    if (command === 'fetch origin main') return result(0);
    if (command === 'rev-parse origin/main') return result(0, `${remoteSha}\n`);
    if (command === 'merge-base --is-ancestor HEAD origin/main') return result(0);
    if (command === 'merge --ff-only origin/main') return result(0);
    return result(1);
  });
  let rawIdentity: unknown | undefined;
  const written: LauncherRuntimeIdentity[] = [];
  const removed: string[] = [];
  const terminated: number[] = [];
  let reexecCount = 0;
  const defaultDeps: CanonicalLaunchDeps = {
    runGit,
    readIdentity: async () => rawIdentity,
    writeIdentity: async (_identityPath, identity) => {
      rawIdentity = identity;
      written.push(identity);
      records.set('identity', identity);
    },
    reserveIdentity: async (_identityPath, identity) => {
      if (rawIdentity !== undefined) return false;
      rawIdentity = identity;
      written.push(identity);
      records.set('identity', identity);
      return true;
    },
    removeIdentity: async (identityPath) => {
      rawIdentity = undefined;
      removed.push(identityPath);
      records.delete('identity');
    },
    inspectProcess: async () => ({
      alive: true,
      commandLine: `${canonicalRoot}${path.sep}scripts${path.sep}launch-local.ts --no-open`,
      // The OS process-start token is optional and platform-specific. These
      // fake ownership tests exercise the stable command-line/root proof;
      // real runtime smoke covers the token when the OS exposes it.
    }),
    terminateProcess: async (pid) => {
      terminated.push(pid);
    },
    waitForProcessExit: async () => true,
    fetchReadiness: async () => true,
    reexec: () => {
      reexecCount += 1;
      return 0;
    },
    now: () => '2026-09-15T12:00:00.000Z',
    createNonce: () => 'nonce-1',
  };
  return {
    deps: { ...defaultDeps, ...overrides },
    runGit,
    runGitCalls,
    localSha,
    remoteSha,
    records,
    written,
    removed,
    terminated,
    get rawIdentity() {
      return rawIdentity;
    },
    set rawIdentity(value: unknown | undefined) {
      rawIdentity = value;
    },
    get reexecCount() {
      return reexecCount;
    },
  };
};

const identityFor = (
  rootDirectory: string,
  sha: string,
  phase: 'starting' | 'ready' = 'ready',
  ownershipNonce = 'old-nonce',
): LauncherRuntimeIdentity => ({
  schemaVersion: 1,
  launcherId: LAUNCHER_ID,
  phase,
  pid: 4567,
  processStartedAt: 'process-start',
  repoRoot: path.resolve(rootDirectory),
  branch: 'main',
  sha,
  host: '127.0.0.1',
  port: 3300,
  url: 'http://127.0.0.1:3300',
  startedAt: '2026-09-15T11:00:00.000Z',
  ownershipNonce,
});

describe('RUS-2-C1 canonical repository preflight', () => {
  it.each([
    ['non-main branch', 'branch --show-current', 'feature', 'CANONICAL_BRANCH_INVALID'],
    [
      'tracked dirty worktree',
      'status --porcelain=v1 --untracked-files=all',
      ' M file',
      'LAUNCHER_WORKTREE_UNSAFE',
    ],
    [
      'staged worktree',
      'status --porcelain=v1 --untracked-files=all',
      'M  file',
      'LAUNCHER_WORKTREE_UNSAFE',
    ],
    [
      'unmerged worktree',
      'status --porcelain=v1 --untracked-files=all',
      'UU file',
      'LAUNCHER_WORKTREE_UNSAFE',
    ],
  ])('%s rejects before fetch or runtime work', async (_name, command, stdout, code) => {
    const root = await makeRoot('shotgun-launch-fake-');
    const fixture = makeFakeDeps(root, {
      runGit: vi.fn((_cwd, args) => {
        if (args.join(' ') === command) return { status: 0, stdout, stderr: '' };
        return { status: 0, stdout: 'main\n', stderr: '' };
      }),
    });
    await expect(
      runCanonicalLaunchPreflight(makeOptions(root), fixture.deps),
    ).rejects.toMatchObject({ code });
    expect(fixture.deps.runGit).toHaveBeenCalledTimes(command.startsWith('branch') ? 1 : 2);
  });

  it('allows unrelated untracked files and reserves a starting identity', async () => {
    const root = await makeRoot('shotgun-launch-untracked-');
    const fixture = makeFakeDeps(root, {
      runGit: vi.fn((_cwd, args) => {
        if (args.join(' ') === 'status --porcelain=v1 --untracked-files=all') {
          return { status: 0, stdout: '?? docs/user-note.md\n', stderr: '' };
        }
        return fixtureDefaultGit(root, args, fixture.localSha, fixture.remoteSha);
      }),
    });
    const outcome = await runCanonicalLaunchPreflight(makeOptions(root), fixture.deps);
    expect(outcome.kind).toBe('start');
    if (outcome.kind === 'start') {
      expect(outcome.runtime.identity.phase).toBe('starting');
      expect(outcome.runtime.identity.sha).toBe(fixture.remoteSha);
      await outcome.runtime.markReady();
      await outcome.runtime.release();
    }
    expect(fixture.deps.runGit).toHaveBeenCalledWith(root, ['fetch', 'origin', 'main']);
  });

  it('allows exactly one of two simultaneous preflights to reserve startup', async () => {
    const root = await makeRoot('shotgun-launch-concurrent-');
    const fixture = makeFakeDeps(root);
    let stored: unknown | undefined;
    const deps: CanonicalLaunchDeps = {
      ...fixture.deps,
      readIdentity: async () => stored,
      reserveIdentity: async (_identityPath, identity) => {
        if (stored !== undefined) return false;
        stored = identity;
        return true;
      },
    };
    const results = await Promise.allSettled([
      runCanonicalLaunchPreflight(makeOptions(root), deps),
      runCanonicalLaunchPreflight(makeOptions(root), deps),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: { code: 'RUNTIME_START_IN_PROGRESS' },
    });
    const winner = results.find((result) => result.status === 'fulfilled');
    if (winner?.status === 'fulfilled' && winner.value.kind === 'start') {
      await winner.value.runtime.release();
    }
  });

  it('uses a real create-only reservation with complete JSON contents', async () => {
    const root = await makeRoot('shotgun-launch-reservation-fs-');
    const identityPath = path.join(root, '.data', 'launcher', 'runtime.json');
    const first = identityFor(
      root,
      '3333333333333333333333333333333333333333',
      'starting',
      'first-nonce',
    );
    const second = identityFor(
      root,
      '4444444444444444444444444444444444444444',
      'starting',
      'second-nonce',
    );
    const deps = createDefaultCanonicalLaunchDeps();
    const reservations = await Promise.all([
      deps.reserveIdentity(identityPath, first),
      deps.reserveIdentity(identityPath, second),
    ]);
    expect(reservations.filter(Boolean)).toHaveLength(1);
    const stored = JSON.parse(await readFile(identityPath, 'utf8')) as LauncherRuntimeIdentity;
    expect([first.ownershipNonce, second.ownershipNonce]).toContain(stored.ownershipNonce);
    expect(stored.phase).toBe('starting');
    expect(stored.sha).toBe(
      stored.ownershipNonce === first.ownershipNonce ? first.sha : second.sha,
    );
  });

  it('fetches a new origin commit, fast-forwards, and requests self-reexec before startup', async () => {
    const fixture = await createRepositoryFixture();
    await commitAndPushSeed(fixture, 'remote-update');
    const deps = createDefaultCanonicalLaunchDeps();
    let reexecCount = 0;
    const outcome = await runCanonicalLaunchPreflight(makeOptions(fixture.work), {
      ...deps,
      reexec: () => {
        reexecCount += 1;
        return 0;
      },
    });
    expect(outcome).toEqual({ kind: 'reexec', exitCode: 0 });
    expect(reexecCount).toBe(1);
    expect(readGit(fixture.work, ['rev-parse', 'HEAD'])).toBe(
      readGit(fixture.work, ['rev-parse', 'origin/main']),
    );
    expect(
      await readFile(path.join(fixture.work, '.data', 'launcher', 'runtime.json')).catch(
        () => undefined,
      ),
    ).toBeUndefined();
  }, 30_000);

  it('refuses local ahead/diverged main without reset, rebase, or merge commit', async () => {
    const fixture = await createRepositoryFixture();
    await writeFile(path.join(fixture.work, 'local.txt'), 'local\n', 'utf8');
    runGit(fixture.work, ['add', 'local.txt']);
    runGit(fixture.work, ['config', 'user.email', 'launcher-test@example.com']);
    runGit(fixture.work, ['config', 'user.name', 'Launcher Test']);
    runGit(fixture.work, ['commit', '-m', 'local-ahead']);
    const before = readGit(fixture.work, ['rev-parse', 'HEAD']);
    await expect(
      runCanonicalLaunchPreflight(makeOptions(fixture.work), createDefaultCanonicalLaunchDeps()),
    ).rejects.toMatchObject({ code: 'GIT_FF_ONLY_FAILED' });
    expect(readGit(fixture.work, ['rev-parse', 'HEAD'])).toBe(before);
  }, 30_000);

  it('refuses a diverged main branch without creating a merge commit', async () => {
    const fixture = await createRepositoryFixture();
    await writeFile(path.join(fixture.work, 'local.txt'), 'local\n', 'utf8');
    runGit(fixture.work, ['add', 'local.txt']);
    runGit(fixture.work, ['config', 'user.email', 'launcher-test@example.com']);
    runGit(fixture.work, ['config', 'user.name', 'Launcher Test']);
    runGit(fixture.work, ['commit', '-m', 'local-divergence']);
    await commitAndPushSeed(fixture, 'remote-divergence');
    const before = readGit(fixture.work, ['rev-parse', 'HEAD']);
    await expect(
      runCanonicalLaunchPreflight(makeOptions(fixture.work), createDefaultCanonicalLaunchDeps()),
    ).rejects.toMatchObject({ code: 'GIT_FF_ONLY_FAILED' });
    expect(readGit(fixture.work, ['rev-parse', 'HEAD'])).toBe(before);
    expect(readGit(fixture.work, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('main');
  }, 30_000);

  it('preserves an unrelated untracked file while the canonical update succeeds', async () => {
    const fixture = await createRepositoryFixture();
    await writeFile(path.join(fixture.work, 'user-note.txt'), 'preserve\n', 'utf8');
    await commitAndPushSeed(fixture, 'remote-update');
    const deps = createDefaultCanonicalLaunchDeps();
    const outcome = await runCanonicalLaunchPreflight(makeOptions(fixture.work), {
      ...deps,
      reexec: () => 0,
    });
    expect(outcome.kind).toBe('reexec');
    expect(await readFile(path.join(fixture.work, 'user-note.txt'), 'utf8')).toBe('preserve\n');
  }, 30_000);
});

const fixtureDefaultGit = (
  _root: string,
  args: readonly string[],
  localSha: string,
  remoteSha: string,
): GitCommandResult => {
  const command = args.join(' ');
  if (command === 'branch --show-current') return { status: 0, stdout: 'main\n', stderr: '' };
  if (command === 'status --porcelain=v1 --untracked-files=all')
    return { status: 0, stdout: '', stderr: '' };
  if (command === 'rev-parse HEAD') return { status: 0, stdout: `${localSha}\n`, stderr: '' };
  if (command === 'fetch origin main') return { status: 0, stdout: '', stderr: '' };
  if (command === 'rev-parse origin/main')
    return { status: 0, stdout: `${remoteSha}\n`, stderr: '' };
  if (command === 'merge-base --is-ancestor HEAD origin/main')
    return { status: 0, stdout: '', stderr: '' };
  if (command === 'merge --ff-only origin/main') return { status: 0, stdout: '', stderr: '' };
  return { status: 0, stdout: '', stderr: '' };
};

describe('RUS-2-C1 runtime identity and ownership', () => {
  it('removes only a dead stale identity before reserving a new runtime', async () => {
    const root = await makeRoot('shotgun-launch-dead-');
    const fixture = makeFakeDeps(root, { inspectProcess: async () => ({ alive: false }) });
    fixture.rawIdentity = identityFor(root, '3333333333333333333333333333333333333333');
    const outcome = await runCanonicalLaunchPreflight(makeOptions(root), fixture.deps);
    expect(outcome.kind).toBe('start');
    expect(fixture.removed).toHaveLength(1);
    expect(fixture.terminated).toHaveLength(0);
  });

  it('removes a dead starting identity and acquires a new reservation', async () => {
    const root = await makeRoot('shotgun-launch-dead-starting-');
    const fixture = makeFakeDeps(root, { inspectProcess: async () => ({ alive: false }) });
    fixture.rawIdentity = identityFor(root, '3333333333333333333333333333333333333333', 'starting');
    const outcome = await runCanonicalLaunchPreflight(makeOptions(root), fixture.deps);
    expect(outcome.kind).toBe('start');
    expect(fixture.removed).toHaveLength(1);
    expect(fixture.written).toHaveLength(1);
    expect(fixture.written[0]).toMatchObject({ phase: 'starting', sha: fixture.remoteSha });
  });

  it('does not terminate or replace a proven live starting owner', async () => {
    const root = await makeRoot('shotgun-launch-starting-');
    const fixture = makeFakeDeps(root);
    fixture.rawIdentity = identityFor(root, fixture.remoteSha, 'starting');
    await expect(
      runCanonicalLaunchPreflight(makeOptions(root), fixture.deps),
    ).rejects.toMatchObject({ code: 'RUNTIME_START_IN_PROGRESS' });
    expect(fixture.terminated).toHaveLength(0);
    expect(fixture.written).toHaveLength(0);
  });

  it('fails closed for a proven live different-SHA starting owner', async () => {
    const root = await makeRoot('shotgun-launch-starting-stale-');
    const fixture = makeFakeDeps(root);
    fixture.rawIdentity = identityFor(root, '3333333333333333333333333333333333333333', 'starting');
    await expect(
      runCanonicalLaunchPreflight(makeOptions(root), fixture.deps),
    ).rejects.toMatchObject({ code: 'RUNTIME_START_IN_PROGRESS' });
    expect(fixture.terminated).toHaveLength(0);
    expect(fixture.written).toHaveLength(0);
  });

  it('reuses only an owned same-SHA runtime after readiness succeeds', async () => {
    const root = await makeRoot('shotgun-launch-reuse-');
    const fixture = makeFakeDeps(root);
    fixture.rawIdentity = identityFor(root, fixture.remoteSha);
    const outcome = await runCanonicalLaunchPreflight(makeOptions(root), fixture.deps);
    expect(outcome).toMatchObject({
      kind: 'reuse',
      identity: { sha: fixture.remoteSha, pid: 4567 },
    });
    expect(fixture.written).toHaveLength(0);
    expect(fixture.terminated).toHaveLength(0);
    expect(fixture.reexecCount).toBe(0);
  });

  it('stops a proven stale-SHA runtime before reserving the target runtime', async () => {
    const root = await makeRoot('shotgun-launch-stale-');
    const fixture = makeFakeDeps(root);
    fixture.rawIdentity = identityFor(root, '3333333333333333333333333333333333333333');
    const outcome = await runCanonicalLaunchPreflight(makeOptions(root), fixture.deps);
    expect(outcome.kind).toBe('start');
    expect(fixture.terminated).toEqual([4567]);
    expect(fixture.removed).toHaveLength(1);
    expect(fixture.written[0]).toMatchObject({ phase: 'starting', sha: fixture.remoteSha });
  });

  it('never terminates a live PID whose launcher ownership cannot be proven', async () => {
    const root = await makeRoot('shotgun-launch-unverified-');
    const fixture = makeFakeDeps(root, {
      inspectProcess: async () => ({ alive: true, commandLine: 'unrelated.exe --pid 4567' }),
    });
    fixture.rawIdentity = identityFor(root, '3333333333333333333333333333333333333333');
    await expect(
      runCanonicalLaunchPreflight(makeOptions(root), fixture.deps),
    ).rejects.toMatchObject({
      code: 'RUNTIME_OWNERSHIP_UNVERIFIED',
    });
    expect(fixture.terminated).toHaveLength(0);
  });

  it('blocks when a proven stale runtime cannot be stopped', async () => {
    const root = await makeRoot('shotgun-launch-stop-failure-');
    const fixture = makeFakeDeps(root, { waitForProcessExit: async () => false });
    fixture.rawIdentity = identityFor(root, '3333333333333333333333333333333333333333');
    await expect(
      runCanonicalLaunchPreflight(makeOptions(root), fixture.deps),
    ).rejects.toMatchObject({
      code: 'STALE_RUNTIME_STOP_FAILED',
    });
    expect(fixture.terminated).toEqual([4567]);
    expect(fixture.written).toHaveLength(0);
  });

  it('rejects malformed identity without authorizing termination', async () => {
    const root = await makeRoot('shotgun-launch-malformed-');
    const fixture = makeFakeDeps(root);
    fixture.rawIdentity = { pid: 4567, sha: 'not-a-sha' };
    await expect(
      runCanonicalLaunchPreflight(makeOptions(root), fixture.deps),
    ).rejects.toMatchObject({
      code: 'RUNTIME_IDENTITY_INVALID',
    });
    expect(fixture.terminated).toHaveLength(0);
  });

  it('promotes starting to ready and releases only the matching nonce', async () => {
    const root = await makeRoot('shotgun-launch-lifecycle-');
    const fixture = makeFakeDeps(root);
    const outcome = await runCanonicalLaunchPreflight(makeOptions(root), fixture.deps);
    expect(outcome.kind).toBe('start');
    if (outcome.kind !== 'start') throw new Error('expected start result');
    expect(outcome.runtime.identity).toMatchObject({
      schemaVersion: 1,
      launcherId: LAUNCHER_ID,
      phase: 'starting',
      repoRoot: root,
      branch: 'main',
      sha: fixture.remoteSha,
      host: '127.0.0.1',
      port: 3300,
      ownershipNonce: 'nonce-1',
    });
    await outcome.runtime.markReady();
    expect(fixture.written.at(-1)).toMatchObject({ phase: 'ready', ownershipNonce: 'nonce-1' });
    await outcome.runtime.release();
    expect(fixture.removed).toHaveLength(1);
  });

  it('reclassifies a reservation race loser without overwriting the winner', async () => {
    const root = await makeRoot('shotgun-launch-race-loser-');
    const fixture = makeFakeDeps(root);
    let reads = 0;
    let winner: LauncherRuntimeIdentity | undefined;
    const deps: CanonicalLaunchDeps = {
      ...fixture.deps,
      readIdentity: async () => {
        reads += 1;
        return reads === 1 ? undefined : winner;
      },
      reserveIdentity: async (_identityPath, identity) => {
        winner = identity;
        return false;
      },
    };
    await expect(runCanonicalLaunchPreflight(makeOptions(root), deps)).rejects.toMatchObject({
      code: 'RUNTIME_START_IN_PROGRESS',
    });
    expect(winner).toMatchObject({ phase: 'starting', sha: fixture.remoteSha });
    expect(fixture.written).toHaveLength(0);
    expect(fixture.terminated).toHaveLength(0);
  });
});
