import { execFileSync, spawnSync } from 'node:child_process';
import { link, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { LaunchFailure } from './launch-core.js';

export const LAUNCHER_ID = 'shotgun-owner-launcher';
export const RUNTIME_IDENTITY_RELATIVE_PATH = path.join('.data', 'launcher', 'runtime.json');
const RUNTIME_SCHEMA_VERSION = 1;
const PROCESS_EXIT_WAIT_MS = 3_000;

export type RuntimeIdentityPhase = 'starting' | 'ready';

export type LauncherRuntimeIdentity = {
  readonly schemaVersion: 1;
  readonly launcherId: typeof LAUNCHER_ID;
  readonly phase: RuntimeIdentityPhase;
  readonly pid: number;
  readonly processStartedAt: string;
  readonly repoRoot: string;
  readonly branch: 'main';
  readonly sha: string;
  readonly host: string;
  readonly port: number;
  readonly url: string;
  readonly startedAt: string;
  readonly ownershipNonce: string;
};

export type GitCommandResult = {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
};

export type ProcessInspection = {
  readonly alive: boolean;
  readonly commandLine?: string;
  readonly processStartedAt?: string;
};

export type CanonicalLaunchDeps = {
  readonly runGit: (cwd: string, args: readonly string[]) => GitCommandResult;
  readonly readIdentity: (identityPath: string) => Promise<unknown | undefined>;
  readonly writeIdentity: (
    identityPath: string,
    identity: LauncherRuntimeIdentity,
  ) => Promise<void>;
  readonly reserveIdentity: (
    identityPath: string,
    identity: LauncherRuntimeIdentity,
  ) => Promise<boolean>;
  readonly removeIdentity: (identityPath: string) => Promise<void>;
  readonly inspectProcess: (pid: number) => Promise<ProcessInspection>;
  readonly terminateProcess: (pid: number) => Promise<void>;
  readonly waitForProcessExit: (pid: number, timeoutMs: number) => Promise<boolean>;
  readonly fetchReadiness: (url: string, timeoutMs: number) => Promise<boolean>;
  readonly reexec: (nextCount: number) => number;
  readonly now: () => string;
  readonly createNonce: () => string;
};

export type CanonicalLaunchPreflightOptions = {
  readonly rootDirectory: string;
  readonly host: string;
  readonly port: number;
  readonly reexecCount: number;
  readonly log?: (message: string) => void;
  readonly identityPath?: string;
};

export type StartedCanonicalRuntime = {
  readonly identity: LauncherRuntimeIdentity;
  readonly markReady: () => Promise<void>;
  readonly release: () => Promise<void>;
};

export type CanonicalLaunchPreflightResult =
  | { readonly kind: 'reexec'; readonly exitCode: 0 }
  | { readonly kind: 'reuse'; readonly identity: LauncherRuntimeIdentity }
  | { readonly kind: 'start'; readonly runtime: StartedCanonicalRuntime };

const logNoop = (): void => undefined;

const asText = (value: string | Buffer | undefined): string =>
  value === undefined ? '' : Buffer.isBuffer(value) ? value.toString('utf8') : value;

const normalizePath = (value: string): string => {
  const normalized = path.resolve(value).replaceAll('\\', '/');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
};

const normalizeCommandLine = (value: string): string => value.replaceAll('\\', '/').toLowerCase();

const launchFailure = (
  code: ConstructorParameters<typeof LaunchFailure>[0],
  message: string,
  check: string,
  command: string,
): LaunchFailure => new LaunchFailure(code, message, check, command);

const requireGitOutput = (result: GitCommandResult, operation: string, command: string): string => {
  if (result.status !== 0 || result.stdout.trim().length === 0) {
    throw launchFailure(
      'CANONICAL_SHA_MISMATCH',
      `Unable to resolve the canonical ${operation}.`,
      'Confirm the repository has a valid main branch and origin/main.',
      command,
    );
  }
  return result.stdout.trim();
};

const assertSha = (sha: string, operation: string): string => {
  if (!/^[0-9a-f]{40}$/iu.test(sha)) {
    throw launchFailure(
      'CANONICAL_SHA_MISMATCH',
      `The ${operation} is not a full Git commit SHA.`,
      'Confirm origin/main resolves to a full commit.',
      'git rev-parse HEAD && git rev-parse origin/main',
    );
  }
  return sha.toLowerCase();
};

const validateRuntimeIdentity = (value: unknown): LauncherRuntimeIdentity => {
  if (value === null || typeof value !== 'object') {
    throw launchFailure(
      'RUNTIME_IDENTITY_INVALID',
      'The launcher runtime identity is malformed.',
      'Inspect .data/launcher/runtime.json; a malformed identity never authorizes process termination.',
      'Remove only the malformed launcher identity after confirming no owned runtime is live.',
    );
  }
  const candidate = value as Record<string, unknown>;
  const valid =
    candidate.schemaVersion === RUNTIME_SCHEMA_VERSION &&
    candidate.launcherId === LAUNCHER_ID &&
    (candidate.phase === 'starting' || candidate.phase === 'ready') &&
    typeof candidate.pid === 'number' &&
    Number.isInteger(candidate.pid) &&
    candidate.pid > 0 &&
    typeof candidate.processStartedAt === 'string' &&
    candidate.processStartedAt.length > 0 &&
    typeof candidate.repoRoot === 'string' &&
    candidate.repoRoot.length > 0 &&
    candidate.branch === 'main' &&
    typeof candidate.sha === 'string' &&
    /^[0-9a-f]{40}$/iu.test(candidate.sha) &&
    typeof candidate.host === 'string' &&
    candidate.host.length > 0 &&
    typeof candidate.port === 'number' &&
    Number.isInteger(candidate.port) &&
    candidate.port > 0 &&
    candidate.port <= 65_535 &&
    typeof candidate.url === 'string' &&
    candidate.url.length > 0 &&
    typeof candidate.startedAt === 'string' &&
    candidate.startedAt.length > 0 &&
    typeof candidate.ownershipNonce === 'string' &&
    candidate.ownershipNonce.length > 0;
  if (!valid) {
    throw launchFailure(
      'RUNTIME_IDENTITY_INVALID',
      'The launcher runtime identity is malformed.',
      'Inspect .data/launcher/runtime.json; a malformed identity never authorizes process termination.',
      'Remove only the malformed launcher identity after confirming no owned runtime is live.',
    );
  }
  return {
    schemaVersion: 1,
    launcherId: LAUNCHER_ID,
    phase: candidate.phase as RuntimeIdentityPhase,
    pid: candidate.pid as number,
    processStartedAt: candidate.processStartedAt as string,
    repoRoot: candidate.repoRoot as string,
    branch: 'main',
    sha: (candidate.sha as string).toLowerCase(),
    host: candidate.host as string,
    port: candidate.port as number,
    url: candidate.url as string,
    startedAt: candidate.startedAt as string,
    ownershipNonce: candidate.ownershipNonce as string,
  };
};

const sameRuntime = (left: LauncherRuntimeIdentity, right: LauncherRuntimeIdentity): boolean =>
  left.pid === right.pid &&
  left.launcherId === right.launcherId &&
  left.ownershipNonce === right.ownershipNonce;

const provesSameRepoLaunchLocalCommand = (
  commandLine: string | undefined,
  rootDirectory: string,
): boolean => {
  if (commandLine === undefined || commandLine.trim().length === 0) return false;
  const normalizedCommandLine = normalizeCommandLine(commandLine);
  const expectedRoot = normalizePath(rootDirectory).toLowerCase();
  return (
    normalizedCommandLine.includes(expectedRoot) && normalizedCommandLine.includes('launch-local')
  );
};

const proveOwnership = (
  identity: LauncherRuntimeIdentity,
  inspection: ProcessInspection,
  rootDirectory: string,
): boolean => {
  if (!inspection.alive || identity.launcherId !== LAUNCHER_ID) return false;
  if (normalizePath(identity.repoRoot) !== normalizePath(rootDirectory)) return false;
  if (!provesSameRepoLaunchLocalCommand(inspection.commandLine, rootDirectory)) return false;
  if (
    inspection.processStartedAt !== undefined &&
    inspection.processStartedAt !== identity.processStartedAt
  ) {
    return false;
  }
  return true;
};

const removeIfCurrent = async (
  identityPath: string,
  expected: LauncherRuntimeIdentity,
  deps: CanonicalLaunchDeps,
): Promise<void> => {
  const raw = await deps.readIdentity(identityPath);
  if (raw === undefined) return;
  const current = validateRuntimeIdentity(raw);
  if (sameRuntime(current, expected)) await deps.removeIdentity(identityPath);
};

const stopOwnedRuntime = async (
  identityPath: string,
  identity: LauncherRuntimeIdentity,
  deps: CanonicalLaunchDeps,
): Promise<void> => {
  await deps.terminateProcess(identity.pid);
  if (!(await deps.waitForProcessExit(identity.pid, PROCESS_EXIT_WAIT_MS))) {
    throw launchFailure(
      'STALE_RUNTIME_STOP_FAILED',
      `The stale launcher runtime PID ${identity.pid} did not stop safely.`,
      'Stop the proven launcher-owned runtime and retry; do not start a competing runtime.',
      `Stop the launcher runtime for PID ${identity.pid} and run npm run launch again.`,
    );
  }
  await removeIfCurrent(identityPath, identity, deps);
};

const runtimeStartInProgress = (pid?: number): LaunchFailure =>
  launchFailure(
    'RUNTIME_START_IN_PROGRESS',
    pid === undefined
      ? 'Another canonical launcher is already reserving the runtime startup slot.'
      : `The canonical launcher runtime PID ${pid} is still starting.`,
    'Wait for the existing owner to become ready, then retry the launcher; do not terminate or replace it.',
    'Retry npm run launch after the existing launcher reports READY.',
  );

const assertBranchAndWorktree = (rootDirectory: string, deps: CanonicalLaunchDeps): void => {
  const branch = deps.runGit(rootDirectory, ['branch', '--show-current']);
  if (branch.status !== 0 || branch.stdout.trim() !== 'main') {
    throw launchFailure(
      'CANONICAL_BRANCH_INVALID',
      'The owner launcher may run only from the main branch.',
      'Switch to main explicitly; the launcher never checks out another branch.',
      'git checkout main',
    );
  }
  const status = deps.runGit(rootDirectory, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (status.status !== 0) {
    throw launchFailure(
      'LAUNCHER_WORKTREE_UNSAFE',
      'The launcher could not verify the repository worktree.',
      'Confirm the repository is a valid Git worktree.',
      'git status --porcelain=v1 --untracked-files=all',
    );
  }
  const unsafe = status.stdout
    .split(/\r?\n/u)
    .filter((line) => line.length > 0)
    .filter((line) => !line.startsWith('??'));
  if (unsafe.length > 0) {
    throw launchFailure(
      'LAUNCHER_WORKTREE_UNSAFE',
      'Tracked, staged, or unmerged worktree changes prevent canonical launch.',
      'Commit or otherwise move tracked/index changes before launching. Unrelated untracked files are allowed.',
      'git diff && git diff --cached && git status --porcelain=v1',
    );
  }
};

const assertGitSuccess = (
  result: GitCommandResult,
  code: ConstructorParameters<typeof LaunchFailure>[0],
  message: string,
  check: string,
  command: string,
): void => {
  if (result.status !== 0) throw launchFailure(code, message, check, command);
};

export const runCanonicalLaunchPreflight = async (
  options: CanonicalLaunchPreflightOptions,
  deps: CanonicalLaunchDeps,
): Promise<CanonicalLaunchPreflightResult> => {
  const log = options.log ?? logNoop;
  const rootDirectory = path.resolve(options.rootDirectory);
  const identityPath =
    options.identityPath ?? path.join(rootDirectory, RUNTIME_IDENTITY_RELATIVE_PATH);

  assertBranchAndWorktree(rootDirectory, deps);
  const localShaBeforeFetch = assertSha(
    requireGitOutput(
      deps.runGit(rootDirectory, ['rev-parse', 'HEAD']),
      'local HEAD',
      'git rev-parse HEAD',
    ),
    'local HEAD',
  );

  const fetch = deps.runGit(rootDirectory, ['fetch', 'origin', 'main']);
  assertGitSuccess(
    fetch,
    'GIT_FETCH_FAILED',
    'The launcher could not fetch origin/main.',
    'Confirm the origin remote and network are available.',
    'git fetch origin main',
  );
  const remoteSha = assertSha(
    requireGitOutput(
      deps.runGit(rootDirectory, ['rev-parse', 'origin/main']),
      'origin/main',
      'git rev-parse origin/main',
    ),
    'origin/main',
  );

  log(`[launch] CANONICAL branch=main sha=${remoteSha}`);

  const classifyExistingRuntime = async (
    existingRaw: unknown | undefined,
  ): Promise<LauncherRuntimeIdentity | undefined> => {
    if (existingRaw === undefined) return undefined;
    const existing = validateRuntimeIdentity(existingRaw);
    const inspection = await deps.inspectProcess(existing.pid);
    if (!inspection.alive) {
      await removeIfCurrent(identityPath, existing, deps);
      log(`[launch] STALE identity removed pid=${existing.pid}`);
      return undefined;
    }
    if (
      inspection.processStartedAt !== undefined &&
      inspection.processStartedAt.length > 0 &&
      inspection.processStartedAt !== existing.processStartedAt &&
      inspection.commandLine !== undefined &&
      inspection.commandLine.trim().length > 0 &&
      !provesSameRepoLaunchLocalCommand(inspection.commandLine, rootDirectory)
    ) {
      await removeIfCurrent(identityPath, existing, deps);
      log(
        `[launch] PID_REUSE_STALE_IDENTITY_REMOVED pid=${existing.pid}` +
          ` recordedProcessStartedAt=${existing.processStartedAt}` +
          ` currentProcessStartedAt=${inspection.processStartedAt}`,
      );
      return undefined;
    }
    if (!proveOwnership(existing, inspection, rootDirectory)) {
      throw launchFailure(
        'RUNTIME_OWNERSHIP_UNVERIFIED',
        `The recorded runtime PID ${existing.pid} is live but ownership cannot be proven.`,
        'Do not terminate an unverified PID; inspect the process and retry after safe resolution.',
        `Inspect process PID ${existing.pid} without terminating it.`,
      );
    }
    if (existing.phase === 'starting') throw runtimeStartInProgress(existing.pid);
    if (
      existing.sha === remoteSha &&
      existing.repoRoot !== '' &&
      normalizePath(existing.repoRoot) === normalizePath(rootDirectory) &&
      existing.host === options.host &&
      existing.port === options.port &&
      (await deps.fetchReadiness(existing.url, 30_000))
    ) {
      return existing;
    }
    await stopOwnedRuntime(identityPath, existing, deps);
    log(`[launch] STALE runtime stopped pid=${existing.pid} sha=${existing.sha}`);
    return undefined;
  };

  let reusable = await classifyExistingRuntime(await deps.readIdentity(identityPath));

  if (localShaBeforeFetch !== remoteSha) {
    const ancestor = deps.runGit(rootDirectory, [
      'merge-base',
      '--is-ancestor',
      'HEAD',
      'origin/main',
    ]);
    assertGitSuccess(
      ancestor,
      'GIT_FF_ONLY_FAILED',
      'The local main branch is ahead of or diverged from origin/main.',
      'Reconcile the local branch explicitly; the launcher never resets, rebases, or creates a merge commit.',
      'git merge-base --is-ancestor HEAD origin/main',
    );
    const update = deps.runGit(rootDirectory, ['merge', '--ff-only', 'origin/main']);
    assertGitSuccess(
      update,
      'GIT_FF_ONLY_FAILED',
      'The launcher could not fast-forward main to origin/main.',
      'Resolve the fast-forward condition explicitly; the launcher never resets, rebases, or merges.',
      'git merge --ff-only origin/main',
    );
  }

  const finalHead = assertSha(
    requireGitOutput(
      deps.runGit(rootDirectory, ['rev-parse', 'HEAD']),
      'final HEAD',
      'git rev-parse HEAD',
    ),
    'final HEAD',
  );
  const finalOrigin = assertSha(
    requireGitOutput(
      deps.runGit(rootDirectory, ['rev-parse', 'origin/main']),
      'final origin/main',
      'git rev-parse origin/main',
    ),
    'final origin/main',
  );
  if (finalHead !== finalOrigin || finalHead !== remoteSha) {
    throw launchFailure(
      'CANONICAL_SHA_MISMATCH',
      'The launcher could not prove HEAD equals freshly fetched origin/main.',
      'Compare the final local and remote commit SHAs.',
      'git rev-parse HEAD && git rev-parse origin/main',
    );
  }

  if (reusable !== undefined) {
    log(`[launch] REUSE pid=${reusable.pid} sha=${reusable.sha} url=${reusable.url}`);
    return { kind: 'reuse', identity: reusable };
  }

  if (localShaBeforeFetch !== finalHead) {
    if (options.reexecCount > 0) {
      throw launchFailure(
        'CANONICAL_REEXEC_FAILED',
        'The launcher repository changed again during canonical self-reexec.',
        'Retry from the newly updated main branch after confirming origin/main is stable.',
        'npm run launch -- --no-open',
      );
    }
    log(`[launch] UPDATE ${localShaBeforeFetch} -> ${finalHead}`);
    log(`[launch] REEXEC ${finalHead}`);
    const exitCode = deps.reexec(options.reexecCount + 1);
    if (exitCode !== 0) {
      throw launchFailure(
        'CANONICAL_REEXEC_FAILED',
        'The canonical launcher self-reexec failed.',
        'Retry the launcher from the verified main branch.',
        'npm run launch -- --no-open',
      );
    }
    return { kind: 'reexec', exitCode: 0 };
  }

  const startedAt = deps.now();
  const currentProcess = await deps.inspectProcess(process.pid);
  const identity: LauncherRuntimeIdentity = {
    schemaVersion: 1,
    launcherId: LAUNCHER_ID,
    phase: 'starting',
    pid: process.pid,
    processStartedAt: currentProcess.processStartedAt ?? startedAt,
    repoRoot: rootDirectory,
    branch: 'main',
    sha: finalHead,
    host: options.host,
    port: options.port,
    url: `http://${options.host}:${options.port}`,
    startedAt,
    ownershipNonce: deps.createNonce(),
  };
  let reserved = await deps.reserveIdentity(identityPath, identity);
  if (!reserved) {
    reusable = await classifyExistingRuntime(await deps.readIdentity(identityPath));
    if (reusable === undefined) {
      reserved = await deps.reserveIdentity(identityPath, identity);
      if (!reserved) throw runtimeStartInProgress();
    }
  }
  if (reusable !== undefined) {
    log(`[launch] REUSE pid=${reusable.pid} sha=${reusable.sha} url=${reusable.url}`);
    return { kind: 'reuse', identity: reusable };
  }
  log(`[launch] RUNTIME pid=${identity.pid} sha=${identity.sha} url=${identity.url}`);

  const markReady = async (): Promise<void> => {
    const ready: LauncherRuntimeIdentity = { ...identity, phase: 'ready' };
    const current = await deps.readIdentity(identityPath);
    if (current === undefined || !sameRuntime(validateRuntimeIdentity(current), identity)) {
      throw launchFailure(
        'RUNTIME_IDENTITY_INVALID',
        'The launcher runtime identity changed before readiness was recorded.',
        'Do not overwrite another launcher identity; inspect .data/launcher/runtime.json and retry.',
        'Inspect .data/launcher/runtime.json before retrying npm run launch.',
      );
    }
    await deps.writeIdentity(identityPath, ready);
  };
  const release = async (): Promise<void> => {
    await removeIfCurrent(identityPath, identity, deps);
  };
  return { kind: 'start', runtime: { identity, markReady, release } };
};

export const createDefaultCanonicalLaunchDeps = (): CanonicalLaunchDeps => ({
  runGit: (cwd, args) => {
    try {
      const stdout = execFileSync('git', [...args], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { status: 0, stdout: asText(stdout), stderr: '' };
    } catch (error) {
      const failure = error as {
        status?: number | null;
        stdout?: string | Buffer;
        stderr?: string | Buffer;
      };
      return {
        status: typeof failure.status === 'number' ? failure.status : 1,
        stdout: asText(failure.stdout),
        stderr: asText(failure.stderr),
      };
    }
  },
  readIdentity: async (identityPath) => {
    try {
      return JSON.parse(await readFile(identityPath, 'utf8')) as unknown;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  },
  writeIdentity: async (identityPath, identity) => {
    await mkdir(path.dirname(identityPath), { recursive: true });
    const temporaryPath = `${identityPath}.${identity.ownershipNonce}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(identity, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    try {
      await rename(temporaryPath, identityPath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => {});
      throw error;
    }
  },
  reserveIdentity: async (identityPath, identity) => {
    await mkdir(path.dirname(identityPath), { recursive: true });
    const temporaryPath = `${identityPath}.${identity.ownershipNonce}.${randomUUID()}.reserve.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(identity, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    try {
      await link(temporaryPath, identityPath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw error;
    } finally {
      await unlink(temporaryPath).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      });
    }
  },
  removeIdentity: async (identityPath) => {
    await unlink(identityPath).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
  },
  inspectProcess: async (pid) => {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return { alive: false };
      if ((error as NodeJS.ErrnoException).code !== 'EPERM') return { alive: false };
    }
    try {
      if (process.platform === 'win32') {
        const script = [
          `$p=Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}";`,
          'if ($null -eq $p) { exit 2 };',
          '$started = $null;',
          'if ($null -ne $p.CreationDate) { $started = $p.CreationDate.ToUniversalTime().ToString("o") };',
          '[pscustomobject]@{CommandLine=$p.CommandLine; ProcessStartedAt=$started} | ConvertTo-Json -Compress',
        ].join(' ');
        const output = execFileSync(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', script],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
        );
        const parsed = JSON.parse(asText(output)) as {
          CommandLine?: string;
          ProcessStartedAt?: string;
        };
        return {
          alive: true,
          commandLine: parsed.CommandLine,
          processStartedAt: parsed.ProcessStartedAt ?? undefined,
        };
      }
      const commandLine = execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return { alive: true, commandLine: asText(commandLine).trim() };
    } catch {
      return { alive: false };
    }
  },
  terminateProcess: async (pid) => {
    try {
      process.kill(pid, 'SIGTERM');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  },
  waitForProcessExit: async (pid, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        process.kill(pid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
    return false;
  },
  fetchReadiness: async (url, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const health = await fetch(`${url}/health`);
        if (health.ok) {
          const root = await fetch(url);
          if (root.ok && (await root.text()).includes('<div id="root">')) return true;
        }
      } catch {
        // Retry until the same readiness deadline used by the launcher.
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
    }
    return false;
  },
  reexec: (nextCount) => {
    const child = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
      stdio: 'inherit',
      env: { ...process.env, SHOTGUN_LAUNCH_REEXEC_COUNT: String(nextCount) },
    });
    if (child.error || child.signal !== null) return 1;
    return child.status ?? 1;
  },
  now: () => new Date().toISOString(),
  createNonce: randomUUID,
});
