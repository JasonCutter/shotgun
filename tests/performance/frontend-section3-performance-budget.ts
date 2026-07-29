type JsonRecord = Record<string, unknown>;

export type PerformanceProfileId = 'desktop' | 'mobile';
export type PerformanceCacheProfile = 'cold' | 'warm';

export type PerformanceBudget = {
  readonly schemaVersion: '1.0.0';
  readonly budgetId: string;
  readonly name: string;
  readonly status: 'APPROVED';
  readonly approval: { readonly actor: 'user'; readonly date: '2026-07-29' };
  readonly measurementContract: {
    readonly datasets: readonly ['representative', 'stress'];
    readonly profiles: Readonly<Record<PerformanceProfileId, JsonRecord>>;
    readonly scenarios: readonly string[];
    readonly warmupRuns: 3;
    readonly recordedRuns: Readonly<Record<PerformanceCacheProfile, number>>;
    readonly statistic: 'NEAREST_RANK_P95';
    readonly seedDigests: Readonly<Record<'representative' | 'stress', string>>;
  };
  readonly globalP95Limits: Readonly<Record<string, number>>;
  readonly profileCacheP95Limits: Readonly<
    Record<
      string,
      Readonly<Record<PerformanceProfileId, Readonly<Record<PerformanceCacheProfile, number>>>>
    >
  >;
  readonly notApplicable: Readonly<Record<string, readonly string[]>>;
  readonly javascriptBundle: {
    readonly rawBytes: number;
    readonly directGzipBytes: number;
  };
  readonly scopeLimitations: JsonRecord;
};

export type PerformanceSummaryGroup = {
  readonly dataset: string;
  readonly profile: string;
  readonly scenario: string;
  readonly cacheProfile: string;
  readonly metrics: Readonly<
    Record<
      string,
      {
        readonly validRuns: number;
        readonly median: number | null;
        readonly p95: number | null;
        readonly values: readonly number[];
      }
    >
  >;
};

export type PerformanceRawRun = {
  readonly dataset: string;
  readonly profile: string;
  readonly scenario: string;
  readonly cacheProfile: string;
};

export type PerformanceBudgetCheck = {
  readonly kind: 'CONTRACT' | 'SUMMARY_P95' | 'BUNDLE_TOTAL';
  readonly metric: string;
  readonly dataset?: string;
  readonly profile?: string;
  readonly scenario?: string;
  readonly cacheProfile?: string;
  readonly observed: number | string;
  readonly limit: number | string;
  readonly status: 'PASS' | 'FAIL' | 'NOT_APPLICABLE';
};

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requireRecord = (value: unknown, path: string): JsonRecord => {
  if (!isRecord(value)) throw new Error(`${path} must be an object.`);
  return value;
};

const requireString = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${path} must be a non-empty string.`);
  }
  return value;
};

const requireNumber = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${path} must be a finite non-negative number.`);
  }
  return value;
};

const requireStringArray = (value: unknown, path: string): readonly string[] => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${path} must be a string array.`);
  }
  return value;
};

const decodeNumberRecord = (value: unknown, path: string): Readonly<Record<string, number>> =>
  Object.fromEntries(
    Object.entries(requireRecord(value, path)).map(([key, entry]) => [
      key,
      requireNumber(entry, `${path}.${key}`),
    ]),
  );

export const decodePerformanceBudget = (value: unknown): PerformanceBudget => {
  const root = requireRecord(value, 'budget');
  const approval = requireRecord(root.approval, 'budget.approval');
  const contract = requireRecord(root.measurementContract, 'budget.measurementContract');
  const datasets = requireStringArray(contract.datasets, 'budget.measurementContract.datasets');
  const profiles = requireRecord(contract.profiles, 'budget.measurementContract.profiles');
  const recordedRuns = decodeNumberRecord(
    contract.recordedRuns,
    'budget.measurementContract.recordedRuns',
  );
  const seedDigests = requireRecord(contract.seedDigests, 'budget.measurementContract.seedDigests');
  const profileCacheLimits = requireRecord(
    root.profileCacheP95Limits,
    'budget.profileCacheP95Limits',
  );
  const decodedProfileCacheLimits = Object.fromEntries(
    Object.entries(profileCacheLimits).map(([metric, profileValue]) => {
      const profileRecord = requireRecord(profileValue, `budget.profileCacheP95Limits.${metric}`);
      return [
        metric,
        Object.fromEntries(
          ['desktop', 'mobile'].map((profile) => {
            const cacheRecord = decodeNumberRecord(
              profileRecord[profile],
              `budget.profileCacheP95Limits.${metric}.${profile}`,
            );
            return [
              profile,
              {
                cold: requireNumber(
                  cacheRecord.cold,
                  `budget.profileCacheP95Limits.${metric}.${profile}.cold`,
                ),
                warm: requireNumber(
                  cacheRecord.warm,
                  `budget.profileCacheP95Limits.${metric}.${profile}.warm`,
                ),
              },
            ];
          }),
        ),
      ];
    }),
  ) as PerformanceBudget['profileCacheP95Limits'];
  const notApplicable = Object.fromEntries(
    Object.entries(requireRecord(root.notApplicable, 'budget.notApplicable')).map(
      ([metric, scenarios]) => [
        metric,
        requireStringArray(scenarios, `budget.notApplicable.${metric}`),
      ],
    ),
  );
  const javascriptBundle = requireRecord(root.javascriptBundle, 'budget.javascriptBundle');

  if (root.schemaVersion !== '1.0.0') throw new Error('Unsupported performance budget version.');
  if (root.status !== 'APPROVED') throw new Error('Performance budget must be APPROVED.');
  if (approval.actor !== 'user' || approval.date !== '2026-07-29') {
    throw new Error('Performance budget approval binding is invalid.');
  }
  if (datasets.join('|') !== 'representative|stress') {
    throw new Error('Performance budget datasets are invalid.');
  }
  if (contract.warmupRuns !== 3) {
    throw new Error('Performance budget warm-up count must be 3.');
  }
  if (recordedRuns.cold !== 5 || recordedRuns.warm !== 10) {
    throw new Error('Performance budget recorded run counts must be cold=5 and warm=10.');
  }
  if (contract.statistic !== 'NEAREST_RANK_P95') {
    throw new Error('Performance budget statistic must be NEAREST_RANK_P95.');
  }
  const expectedGlobalMetrics = [
    'browserStorageBytes',
    'cacheActiveQueryCount',
    'cacheQueryCount',
    'cacheSerializedBytes',
    'domNodes',
    'jsHeapUsedBytes',
    'networkTransferBytes',
    'projectionCompositionMs',
    'responseBytes',
    'serverQueryMs',
  ];
  if (
    Object.keys(requireRecord(root.globalP95Limits, 'budget.globalP95Limits')).sort().join('|') !==
    expectedGlobalMetrics.join('|')
  ) {
    throw new Error('Performance budget global metric set is invalid.');
  }
  if (
    Object.keys(profileCacheLimits).sort().join('|') !==
    'clientRenderMs|interactionReadinessMs|networkTransferMs|runtimeDecodeMs'
  ) {
    throw new Error('Performance budget profile/cache metric set is invalid.');
  }

  return {
    schemaVersion: '1.0.0',
    budgetId: requireString(root.budgetId, 'budget.budgetId'),
    name: requireString(root.name, 'budget.name'),
    status: 'APPROVED',
    approval: { actor: 'user', date: '2026-07-29' },
    measurementContract: {
      datasets: ['representative', 'stress'],
      profiles: {
        desktop: requireRecord(profiles.desktop, 'budget.measurementContract.profiles.desktop'),
        mobile: requireRecord(profiles.mobile, 'budget.measurementContract.profiles.mobile'),
      },
      scenarios: requireStringArray(contract.scenarios, 'budget.measurementContract.scenarios'),
      warmupRuns: requireNumber(contract.warmupRuns, 'budget.measurementContract.warmupRuns') as 3,
      recordedRuns: {
        cold: requireNumber(recordedRuns.cold, 'budget.measurementContract.recordedRuns.cold'),
        warm: requireNumber(recordedRuns.warm, 'budget.measurementContract.recordedRuns.warm'),
      },
      statistic: requireString(
        contract.statistic,
        'budget.measurementContract.statistic',
      ) as 'NEAREST_RANK_P95',
      seedDigests: {
        representative: requireString(
          seedDigests.representative,
          'budget.measurementContract.seedDigests.representative',
        ),
        stress: requireString(seedDigests.stress, 'budget.measurementContract.seedDigests.stress'),
      },
    },
    globalP95Limits: decodeNumberRecord(root.globalP95Limits, 'budget.globalP95Limits'),
    profileCacheP95Limits: decodedProfileCacheLimits,
    notApplicable,
    javascriptBundle: {
      rawBytes: requireNumber(javascriptBundle.rawBytes, 'budget.javascriptBundle.rawBytes'),
      directGzipBytes: requireNumber(
        javascriptBundle.directGzipBytes,
        'budget.javascriptBundle.directGzipBytes',
      ),
    },
    scopeLimitations: requireRecord(root.scopeLimitations, 'budget.scopeLimitations'),
  };
};

const addContractCheck = (
  checks: PerformanceBudgetCheck[],
  metric: string,
  observed: number | string,
  limit: number | string,
  passed: boolean,
) => {
  checks.push({
    kind: 'CONTRACT',
    metric,
    observed,
    limit,
    status: passed ? 'PASS' : 'FAIL',
  });
};

export const evaluatePerformanceBudget = (input: {
  readonly budget: PerformanceBudget;
  readonly environment: JsonRecord;
  readonly seedManifest: readonly JsonRecord[];
  readonly summary: readonly PerformanceSummaryGroup[];
  readonly runs: readonly PerformanceRawRun[];
  readonly failures: readonly unknown[];
  readonly bundle: readonly {
    readonly name: string;
    readonly bytes: number;
    readonly gzipBytes: number;
  }[];
  readonly budgetSha256: string;
}) => {
  const { budget } = input;
  const checks: PerformanceBudgetCheck[] = [];
  const expectedGroupKeys = new Set<string>();
  for (const dataset of budget.measurementContract.datasets) {
    for (const profile of ['desktop', 'mobile'] as const) {
      for (const scenario of budget.measurementContract.scenarios) {
        for (const cacheProfile of ['cold', 'warm'] as const) {
          expectedGroupKeys.add([dataset, profile, scenario, cacheProfile].join('|'));
        }
      }
    }
  }
  const actualGroupKeys = input.summary.map((group) =>
    [group.dataset, group.profile, group.scenario, group.cacheProfile].join('|'),
  );
  addContractCheck(
    checks,
    'summaryGroupCount',
    new Set(actualGroupKeys).size,
    expectedGroupKeys.size,
    actualGroupKeys.length === expectedGroupKeys.size &&
      new Set(actualGroupKeys).size === expectedGroupKeys.size &&
      actualGroupKeys.every((key) => expectedGroupKeys.has(key)),
  );

  const expectedRunCount =
    budget.measurementContract.datasets.length *
    2 *
    budget.measurementContract.scenarios.length *
    (budget.measurementContract.recordedRuns.cold + budget.measurementContract.recordedRuns.warm);
  addContractCheck(
    checks,
    'recordedRunCount',
    input.runs.length,
    expectedRunCount,
    input.runs.length === expectedRunCount,
  );
  addContractCheck(
    checks,
    'warmupRuns',
    requireNumber(input.environment.warmupCount, 'environment.warmupCount'),
    budget.measurementContract.warmupRuns,
    input.environment.warmupCount === budget.measurementContract.warmupRuns,
  );
  for (const cacheProfile of ['cold', 'warm'] as const) {
    const environmentKey = `${cacheProfile}Count`;
    const expected = budget.measurementContract.recordedRuns[cacheProfile];
    addContractCheck(
      checks,
      environmentKey,
      requireNumber(input.environment[environmentKey], `environment.${environmentKey}`),
      expected,
      input.environment[environmentKey] === expected,
    );
  }
  for (const cacheProfile of ['cold', 'warm'] as const) {
    const expected = budget.measurementContract.recordedRuns[cacheProfile];
    for (const key of expectedGroupKeys) {
      if (!key.endsWith(`|${cacheProfile}`)) continue;
      const count = input.runs.filter(
        (run) => [run.dataset, run.profile, run.scenario, run.cacheProfile].join('|') === key,
      ).length;
      if (count !== expected) {
        addContractCheck(checks, `recordedRuns:${key}`, count, expected, false);
      }
    }
  }
  if (!checks.some((check) => check.metric.startsWith('recordedRuns:'))) {
    addContractCheck(checks, 'recordedRunsPerGroup', 'all groups match', 'cold=5,warm=10', true);
  }

  for (const dataset of budget.measurementContract.datasets) {
    const seed = input.seedManifest.find((entry) => entry.kind === dataset);
    const observed = typeof seed?.sha256 === 'string' ? seed.sha256 : 'MISSING';
    addContractCheck(
      checks,
      `seedDigest:${dataset}`,
      observed,
      budget.measurementContract.seedDigests[dataset],
      observed === budget.measurementContract.seedDigests[dataset],
    );
  }
  for (const profile of ['desktop', 'mobile'] as const) {
    const actualProfile = Array.isArray(input.environment.profiles)
      ? input.environment.profiles.find((entry) => isRecord(entry) && entry.id === profile)
      : undefined;
    const expectedProfile = budget.measurementContract.profiles[profile];
    const observed = JSON.stringify(actualProfile ?? null);
    const expected = JSON.stringify({ id: profile, ...expectedProfile });
    addContractCheck(checks, `profile:${profile}`, observed, expected, observed === expected);
  }

  for (const group of input.summary) {
    for (const [metric, limit] of Object.entries(budget.globalP95Limits)) {
      const summary = group.metrics[metric];
      const notApplicable = budget.notApplicable[metric]?.includes(group.scenario) ?? false;
      if (notApplicable) {
        checks.push({
          kind: 'SUMMARY_P95',
          metric,
          dataset: group.dataset,
          profile: group.profile,
          scenario: group.scenario,
          cacheProfile: group.cacheProfile,
          observed: summary?.p95 ?? 'NO_VALUE',
          limit,
          status: summary?.validRuns === 0 && summary.p95 === null ? 'NOT_APPLICABLE' : 'FAIL',
        });
        continue;
      }
      const expectedRuns =
        budget.measurementContract.recordedRuns[group.cacheProfile as PerformanceCacheProfile];
      const observed = summary?.p95;
      checks.push({
        kind: 'SUMMARY_P95',
        metric,
        dataset: group.dataset,
        profile: group.profile,
        scenario: group.scenario,
        cacheProfile: group.cacheProfile,
        observed: observed ?? 'MISSING',
        limit,
        status:
          typeof observed === 'number' &&
          summary !== undefined &&
          summary.validRuns === expectedRuns &&
          observed <= limit
            ? 'PASS'
            : 'FAIL',
      });
    }
    for (const [metric, profileLimits] of Object.entries(budget.profileCacheP95Limits)) {
      const limit =
        profileLimits[group.profile as PerformanceProfileId]?.[
          group.cacheProfile as PerformanceCacheProfile
        ];
      const summary = group.metrics[metric];
      const notApplicable = budget.notApplicable[metric]?.includes(group.scenario) ?? false;
      if (notApplicable) {
        checks.push({
          kind: 'SUMMARY_P95',
          metric,
          dataset: group.dataset,
          profile: group.profile,
          scenario: group.scenario,
          cacheProfile: group.cacheProfile,
          observed: summary?.p95 ?? 'NO_VALUE',
          limit,
          status: summary?.validRuns === 0 && summary.p95 === null ? 'NOT_APPLICABLE' : 'FAIL',
        });
        continue;
      }
      const expectedRuns =
        budget.measurementContract.recordedRuns[group.cacheProfile as PerformanceCacheProfile];
      const observed = summary?.p95;
      checks.push({
        kind: 'SUMMARY_P95',
        metric,
        dataset: group.dataset,
        profile: group.profile,
        scenario: group.scenario,
        cacheProfile: group.cacheProfile,
        observed: observed ?? 'MISSING',
        limit: limit ?? 'MISSING_LIMIT',
        status:
          typeof observed === 'number' &&
          typeof limit === 'number' &&
          summary !== undefined &&
          summary.validRuns === expectedRuns &&
          observed <= limit
            ? 'PASS'
            : 'FAIL',
      });
    }
  }

  const javascript = input.bundle.filter((entry) => entry.name.endsWith('.js'));
  addContractCheck(
    checks,
    'javascriptAssetCount',
    javascript.length,
    '>=1',
    javascript.length >= 1,
  );
  const rawBytes = javascript.reduce((total, entry) => total + entry.bytes, 0);
  const directGzipBytes = javascript.reduce((total, entry) => total + entry.gzipBytes, 0);
  checks.push({
    kind: 'BUNDLE_TOTAL',
    metric: 'javascriptBundle.rawBytes',
    observed: rawBytes,
    limit: budget.javascriptBundle.rawBytes,
    status: rawBytes <= budget.javascriptBundle.rawBytes ? 'PASS' : 'FAIL',
  });
  checks.push({
    kind: 'BUNDLE_TOTAL',
    metric: 'javascriptBundle.directGzipBytes',
    observed: directGzipBytes,
    limit: budget.javascriptBundle.directGzipBytes,
    status: directGzipBytes <= budget.javascriptBundle.directGzipBytes ? 'PASS' : 'FAIL',
  });

  const violations = checks.filter((check) => check.status === 'FAIL');
  return {
    schemaVersion: '1.0.0',
    budgetId: budget.budgetId,
    budgetName: budget.name,
    budgetStatus: budget.status,
    approval: budget.approval,
    budgetSha256: input.budgetSha256,
    status: violations.length === 0 ? ('PASS' as const) : ('FAIL' as const),
    checks,
    violations,
    recordedRuns: input.runs.length,
    measuredFailures: input.failures.length,
    exclusions: checks.filter((check) => check.status === 'NOT_APPLICABLE'),
    scopeLimitations: budget.scopeLimitations,
  };
};
