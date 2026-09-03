/**
 * Shared owner-facing environment contract for Shotgun runtime entrypoints.
 *
 * The decoder is intentionally dependency-free and accepts an injected
 * ProcessEnv-like object so launch, application startup, bootstrap, and tests
 * all evaluate the same contract without reading global process state here.
 */

export type RuntimeConfigurationProfile =
  'runtime-production' | 'runtime-development' | 'runtime-test' | 'bootstrap' | 'recovery';

export type EnvironmentKeyClassification =
  | 'required-runtime'
  | 'optional-runtime'
  | 'bootstrap-only'
  | 'test-only'
  | 'compatibility-deprecated';

export type EnvironmentIssueCode = 'MISSING' | 'EMPTY' | 'TOO_SHORT';

export type EnvironmentIssue = {
  readonly key: string;
  readonly code: EnvironmentIssueCode;
};

type EnvironmentContractEntry = {
  readonly key: string;
  readonly classification: EnvironmentKeyClassification;
  readonly requiredIn: readonly RuntimeConfigurationProfile[];
  readonly example: boolean;
  /** Only these keys are parsed/owned by this WP-01 decoder. */
  readonly decoderOwned?: boolean;
  readonly sensitive?: boolean;
};

/**
 * This is the owner-facing contract, not a mechanical inventory of every
 * process.env read in the repository. Internal/legacy/test variables are
 * deliberately classified separately so the drift guard does not turn
 * implementation details into mandatory operator configuration.
 */
export const SHOTGUN_ENVIRONMENT_CONTRACT = [
  {
    key: 'DATABASE_URL',
    classification: 'required-runtime',
    requiredIn: [
      'runtime-production',
      'runtime-development',
      'runtime-test',
      'bootstrap',
      'recovery',
    ],
    example: true,
    decoderOwned: true,
  },
  {
    key: 'SOURCES_STAGING_SECRET',
    classification: 'required-runtime',
    requiredIn: ['runtime-production', 'runtime-development', 'runtime-test', 'recovery'],
    example: true,
    decoderOwned: true,
    sensitive: true,
  },
  {
    key: 'SHOTGUN_RUNTIME_OWNER_ACCOUNT_ID',
    classification: 'required-runtime',
    requiredIn: ['runtime-production'],
    example: true,
    decoderOwned: true,
  },
  {
    key: 'SHOTGUN_BOOTSTRAP_ACCOUNT_ID',
    classification: 'bootstrap-only',
    requiredIn: ['bootstrap'],
    example: true,
    decoderOwned: true,
  },
  {
    key: 'SHOTGUN_BOOTSTRAP_PASSWORD',
    classification: 'bootstrap-only',
    requiredIn: ['bootstrap'],
    example: true,
    decoderOwned: true,
    sensitive: true,
  },
  {
    key: 'SHOTGUN_BOOTSTRAP_PROJECT_ID',
    classification: 'bootstrap-only',
    requiredIn: [],
    example: true,
    decoderOwned: true,
  },
  {
    key: 'ASSET_STORAGE_ROOT',
    classification: 'optional-runtime',
    requiredIn: [],
    example: true,
  },
  {
    key: 'SHOTGUN_PG_TOOL_MODE',
    classification: 'optional-runtime',
    requiredIn: [],
    example: true,
  },
  {
    key: 'PORT',
    classification: 'optional-runtime',
    requiredIn: [],
    example: true,
  },
  {
    key: 'HOST',
    classification: 'optional-runtime',
    requiredIn: [],
    example: true,
  },
  {
    key: 'NODE_ENV',
    classification: 'optional-runtime',
    requiredIn: [],
    example: true,
  },
  {
    key: 'ALLOW_EXTERNAL_BIND',
    classification: 'optional-runtime',
    requiredIn: [],
    example: true,
  },
  {
    key: 'SHOTGUN_DEVELOPMENT_AUTH',
    classification: 'optional-runtime',
    requiredIn: [],
    example: true,
  },
  {
    key: 'GEMINI_API_KEY',
    classification: 'optional-runtime',
    requiredIn: [],
    example: true,
    sensitive: true,
  },
  {
    key: 'GEMINI_MODEL',
    classification: 'optional-runtime',
    requiredIn: [],
    example: true,
  },
  {
    key: 'GEMINI_ALLOW_PRIVATE',
    classification: 'optional-runtime',
    requiredIn: [],
    example: true,
  },
  {
    key: 'AI_PRIVATE_EGRESS_ALLOWED_PROVIDERS',
    classification: 'optional-runtime',
    requiredIn: [],
    example: true,
  },
  {
    key: 'SHOTGUN_CREDENTIAL_MASTER_KEY',
    classification: 'optional-runtime',
    requiredIn: [],
    example: true,
    sensitive: true,
  },
  {
    key: 'SHOTGUN_CREDENTIAL_MASTER_KEY_VERSION',
    classification: 'optional-runtime',
    requiredIn: [],
    example: true,
  },
  {
    key: 'TEST_DATABASE_URL',
    classification: 'test-only',
    requiredIn: [],
    example: false,
  },
] as const satisfies readonly EnvironmentContractEntry[];

export type BootstrapConfiguration = {
  readonly databaseUrl: string;
  readonly accountId: string;
  readonly password: string;
  readonly projectId: string;
};

export type ShotgunRuntimeConfiguration = {
  readonly profile: RuntimeConfigurationProfile;
  readonly databaseUrl?: string;
  readonly stagingSecret?: string;
  readonly runtimeOwnerAccountId?: string;
  readonly bootstrap?: BootstrapConfiguration;
  readonly issues: readonly EnvironmentIssue[];
};

export type EnvironmentOverrides = {
  /** Explicit test/recovery injection; takes precedence over the environment. */
  readonly databaseUrl?: string;
  /** Explicit test/recovery injection; takes precedence over the environment. */
  readonly stagingSecret?: string;
};

const BOOTSTRAP_PROJECT_ID_DEFAULT = 'shotgun';
const RUNTIME_PROFILES: readonly RuntimeConfigurationProfile[] = [
  'runtime-production',
  'runtime-development',
  'runtime-test',
];

const readTrimmed = (
  environment: NodeJS.ProcessEnv,
  key: string,
  override?: string,
): string | undefined => {
  const value = override ?? environment[key];
  return value === undefined ? undefined : value.trim();
};

const isRuntimeProfile = (profile: RuntimeConfigurationProfile): boolean =>
  RUNTIME_PROFILES.includes(profile);

const required = (
  issues: EnvironmentIssue[],
  key: string,
  value: string | undefined,
  code: EnvironmentIssueCode = 'MISSING',
): value is string => {
  if (value === undefined) {
    issues.push({ key, code });
    return false;
  }
  if (value.length === 0) {
    issues.push({ key, code: 'EMPTY' });
    return false;
  }
  return true;
};

const requiredSecret = (
  issues: EnvironmentIssue[],
  key: string,
  value: string | undefined,
): value is string => {
  if (!required(issues, key, value)) return false;
  if (value.trim().length < 32) {
    issues.push({ key, code: 'TOO_SHORT' });
    return false;
  }
  return true;
};

const requiredDatabaseUrl = (
  issues: EnvironmentIssue[],
  value: string | undefined,
): value is string => required(issues, 'DATABASE_URL', value);

const requiredAccountId = (
  issues: EnvironmentIssue[],
  key: string,
  value: string | undefined,
): value is string => required(issues, key, value);

/**
 * Decode a profile in one pass. Every applicable missing/malformed field is
 * accumulated so callers can report one safe actionable error instead of a
 * fix-one-key-at-a-time loop. Secret values are returned only to trusted
 * in-process callers and never appear in issue metadata.
 */
export const decodeShotgunEnvironment = (
  environment: NodeJS.ProcessEnv,
  profile: RuntimeConfigurationProfile,
  overrides: EnvironmentOverrides = {},
): ShotgunRuntimeConfiguration => {
  const issues: EnvironmentIssue[] = [];
  const databaseUrl = readTrimmed(environment, 'DATABASE_URL', overrides.databaseUrl);
  const stagingSecret = overrides.stagingSecret ?? environment.SOURCES_STAGING_SECRET;
  const runtimeOwnerAccountId = readTrimmed(environment, 'SHOTGUN_RUNTIME_OWNER_ACCOUNT_ID');

  const databaseRequired =
    isRuntimeProfile(profile) || profile === 'bootstrap' || profile === 'recovery';
  if (databaseRequired) requiredDatabaseUrl(issues, databaseUrl);

  const stagingRequired = isRuntimeProfile(profile) || profile === 'recovery';
  if (stagingRequired) requiredSecret(issues, 'SOURCES_STAGING_SECRET', stagingSecret);

  if (profile === 'runtime-production') {
    requiredAccountId(issues, 'SHOTGUN_RUNTIME_OWNER_ACCOUNT_ID', runtimeOwnerAccountId);
  } else if (runtimeOwnerAccountId !== undefined && runtimeOwnerAccountId.length === 0) {
    issues.push({ key: 'SHOTGUN_RUNTIME_OWNER_ACCOUNT_ID', code: 'EMPTY' });
  }

  let bootstrap: BootstrapConfiguration | undefined;
  if (profile === 'bootstrap') {
    const accountId = readTrimmed(environment, 'SHOTGUN_BOOTSTRAP_ACCOUNT_ID');
    const password = environment.SHOTGUN_BOOTSTRAP_PASSWORD;
    const configuredProjectId = environment.SHOTGUN_BOOTSTRAP_PROJECT_ID;
    const projectId =
      configuredProjectId === undefined ? BOOTSTRAP_PROJECT_ID_DEFAULT : configuredProjectId.trim();

    const validAccountId = requiredAccountId(issues, 'SHOTGUN_BOOTSTRAP_ACCOUNT_ID', accountId);
    const validPassword = required(issues, 'SHOTGUN_BOOTSTRAP_PASSWORD', password);
    const validProjectId = requiredAccountId(issues, 'SHOTGUN_BOOTSTRAP_PROJECT_ID', projectId);
    if (validAccountId && validPassword && validProjectId && databaseUrl !== undefined) {
      bootstrap = {
        databaseUrl,
        // Authentication normalizes account IDs to lowercase; use that same
        // semantic normalization for runtime/bootstrap identity comparison.
        accountId: accountId.toLowerCase(),
        password,
        projectId,
      };
    }
  }

  return {
    profile,
    ...(databaseUrl === undefined ? {} : { databaseUrl }),
    ...(stagingSecret === undefined ? {} : { stagingSecret }),
    ...(runtimeOwnerAccountId === undefined ? {} : { runtimeOwnerAccountId }),
    ...(bootstrap === undefined ? {} : { bootstrap }),
    issues,
  };
};

export const formatEnvironmentIssues = (issues: readonly EnvironmentIssue[]): string =>
  issues.map(({ key, code }) => `${key} (${code})`).join(', ');

export const environmentExampleKeys = (): readonly string[] =>
  SHOTGUN_ENVIRONMENT_CONTRACT.filter((entry) => entry.example).map((entry) => entry.key);

export const environmentContractEntry = (key: string): EnvironmentContractEntry | undefined =>
  SHOTGUN_ENVIRONMENT_CONTRACT.find((entry) => entry.key === key);
