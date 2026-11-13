/** Separate operator capability. No dotenv, application startup, browser route or provider. */
import { open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import {
  PostgresSurferAccountBootstrap,
  PostgresSurferRegistrationAdmin,
  PostgresSurferRootRenewal,
} from '../adapters/surfer-account-authority-postgres/src/index.js';
import { assertSurferAccountDatabaseTargets } from '../adapters/surfer-account-authority-postgres/src/targets.js';
import {
  decodeSurferAccountBootstrap,
  type SurferAccountBootstrapCommand,
} from '../packages/contracts/src/surfer-account-bootstrap.js';
import {
  decodeSurferRegistrationCommand,
  type SurferRegistrationCommand,
} from '../packages/contracts/src/surfer-account-registration.js';
import { assertSurferJson, surferDigest } from '../packages/contracts/src/surfer-learning.js';
import {
  decodeSurferRootRenewal,
  type SurferRootRenewalCommand,
} from '../packages/contracts/src/surfer-root-renewal.js';
import {
  bootstrapSurferAccountAfterDrain,
  registerSurferAccountAfterDrain,
  renewSurferRootAfterDrain,
} from '../modules/surfer-execution/src/runtime-controls.js';

export type SurferAdminRequest =
  | { schemaVersion: '1.0.0'; kind: 'BOOTSTRAP'; command: SurferAccountBootstrapCommand }
  | { schemaVersion: '1.0.0'; kind: 'REGISTRATION'; command: SurferRegistrationCommand }
  | { schemaVersion: '1.0.0'; kind: 'ROOT_RENEWAL'; command: SurferRootRenewalCommand };
const invalid = () => new Error('Invalid explicit Surfer operator request.');
export function decodeSurferAdminRequest(input: unknown): SurferAdminRequest {
  assertSurferJson(input);
  const r = input as SurferAdminRequest;
  if (
    !r ||
    Object.keys(r).sort().join(',') !== 'command,kind,schemaVersion' ||
    r.schemaVersion !== '1.0.0' ||
    !['BOOTSTRAP', 'REGISTRATION', 'ROOT_RENEWAL'].includes(r.kind)
  )
    throw invalid();
  const result: SurferAdminRequest =
    r.kind === 'BOOTSTRAP'
      ? { ...r, command: decodeSurferAccountBootstrap(r.command) }
      : r.kind === 'REGISTRATION'
        ? { ...r, command: decodeSurferRegistrationCommand(r.command) }
        : { ...r, command: decodeSurferRootRenewal(r.command) };
  if (
    result.command.config.rootPolicy.dailyCallLimit !== null ||
    result.command.config.rootPolicy.surferDailyLimits !== null
  )
    throw invalid();
  return result;
}
export async function readSurferAdminRequest(filename: string): Promise<SurferAdminRequest> {
  const file = await open(filename, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 65536) throw invalid();
    const buffer = Buffer.alloc(65537);
    let size = 0;
    while (size < buffer.length) {
      const read = await file.read(buffer, size, buffer.length - size, size);
      if (!read.bytesRead) break;
      size += read.bytesRead;
    }
    if (size > 65536) throw invalid();
    return decodeSurferAdminRequest(JSON.parse(buffer.subarray(0, size).toString('utf8')));
  } finally {
    await file.close();
  }
}
export function surferAdminTargets(environment: NodeJS.ProcessEnv) {
  const workloadDatabaseUrl = environment.SURFER_ADMIN_WORKLOAD_DATABASE_URL,
    authorityDatabaseUrl = environment.SURFER_ADMIN_AUTHORITY_DATABASE_URL;
  if (!workloadDatabaseUrl || !authorityDatabaseUrl) throw invalid();
  const { authorityDatabaseName } = assertSurferAccountDatabaseTargets(
    workloadDatabaseUrl,
    authorityDatabaseUrl,
  );
  const identity = (value: string) => {
    if (value.length > 8192) throw invalid();
    const url = new URL(value);
    // Require explicit password-auth URLs rather than PG* credential fallback.
    if (!url.username || !url.password) throw invalid();
    for (const k of url.searchParams.keys())
      if (['user', 'password', 'passfile', 'connectionstring'].includes(k.toLowerCase()))
        throw invalid();
    url.password = '';
    url.searchParams.sort();
    return url.href;
  };
  return {
    workloadDatabaseUrl,
    authorityDatabaseUrl,
    authorityDatabaseName,
    identity: {
      workload: identity(workloadDatabaseUrl),
      authority: identity(authorityDatabaseUrl),
    },
  };
}
export async function runSurferAccountAdmin(
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
) {
  if (
    ![2, 4].includes(args.length) ||
    args[0] !== '--request-file' ||
    !args[1] ||
    (args.length === 4 && (args[2] !== '--apply-digest' || !/^sha256:[a-f0-9]{64}$/.test(args[3]!)))
  )
    throw invalid();
  const request = await readSurferAdminRequest(args[1]),
    targets = surferAdminTargets(environment),
    requestDigest = surferDigest({ request, targets: targets.identity });
  if (args.length === 4 && args[3] !== requestDigest) throw invalid();
  const pool = new Pool({
    connectionString: targets.authorityDatabaseUrl,
    max: 1,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
    query_timeout: 10000,
    application_name: 'shotgun-surfer-account-operator',
    // pg otherwise inherits PGOPTIONS, which is outside the reviewed target digest.
    options:
      new URL(targets.authorityDatabaseUrl).searchParams.get('options') ||
      '-c application_name=shotgun-surfer-account-operator',
  });
  try {
    // Registration's old adapter also gets the bootstrap actual-database precondition.
    if (
      (await pool.query('SELECT current_database() AS name')).rows[0]?.name !==
      targets.authorityDatabaseName
    )
      throw invalid();
    if (request.kind === 'ROOT_RENEWAL') {
      const renewal = new PostgresSurferRootRenewal(pool);
      if (args.length === 2)
        return {
          schemaVersion: '1.0.0',
          mode: 'REVIEW' as const,
          kind: 'ROOT_RENEWAL' as const,
          action: request.command.action,
          commandId: request.command.commandId,
          requestDigest,
          rootId: request.command.config.rootPolicy.rootId,
          rootExpiresAtMs: request.command.config.rootPolicy.expiresAtMs,
          dailyCallLimit: null,
          proposal: {
            expiresAtMs: request.command.expiresAtMs,
            retained: request.command.retained,
          },
          currentState: await renewal.inspect(request.command.config),
          applied: false,
        };
      const result = await renewSurferRootAfterDrain([], renewal, request.command);
      return {
        schemaVersion: '1.0.0',
        mode: 'APPLY' as const,
        kind: 'ROOT_RENEWAL' as const,
        requestDigest,
        ...result,
      };
    }
    const bootstrap = new PostgresSurferAccountBootstrap(pool, targets),
      registration = new PostgresSurferRegistrationAdmin(pool);
    if (args.length === 2) {
      const currentState =
        request.kind === 'BOOTSTRAP'
          ? await bootstrap.inspect(request.command.config)
          : await registration.inspect(request.command.config, request.command.projectId);
      return {
        schemaVersion: '1.0.0',
        mode: 'REVIEW',
        kind: request.kind,
        action: request.command.action,
        commandId: request.command.commandId,
        requestDigest,
        rootId: request.command.config.rootPolicy.rootId,
        rootExpiresAtMs: request.command.config.rootPolicy.expiresAtMs,
        dailyCallLimit: null,
        proposal: {
          storeId: request.command.config.rootPolicy.storeId,
          registrationId: request.command.config.registrationId,
          profileDigest: surferDigest(request.command.config.profile),
          expected: request.command.expected,
          ...(request.kind === 'BOOTSTRAP'
            ? {
                createStore: request.command.createStore,
                legacyAuthorityIds: request.command.legacyAuthorityIds,
              }
            : { projectId: request.command.projectId, expiresAtMs: request.command.expiresAtMs }),
        },
        currentState,
        applied: false,
      };
    }
    const result =
      request.kind === 'BOOTSTRAP'
        ? await bootstrapSurferAccountAfterDrain([], bootstrap, request.command)
        : await registerSurferAccountAfterDrain([], registration, request.command);
    return { schemaVersion: '1.0.0', mode: 'APPLY', kind: request.kind, requestDigest, ...result };
  } finally {
    await pool.end();
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(await runSurferAccountAdmin(process.argv.slice(2), process.env)));
  } catch {
    // COMMIT acknowledgement might be lost. Do not claim rollback or retry a write automatically.
    console.error(
      'Surfer account operation NOT_CONFIRMED. Inspect state and replay the same reviewed command if needed.',
    );
    process.exitCode = 1;
  }
}
