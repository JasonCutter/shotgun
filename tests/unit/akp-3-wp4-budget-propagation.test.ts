import { describe, expect, it, vi } from 'vitest';

import {
  createDiscoveryEngine,
  createDiscoverySignalFacade,
  createWp1DiscoveryStrategyRegistry,
  DiscoveryStrategyRegistry,
  type DiscoverySignalPortsV1,
  type DiscoverySignalReadContextV1,
  type DiscoverySignalResourceV1,
  type DiscoveryStrategyV1,
} from '../../modules/discovery-finding-fingerprint/src/index.js';
import {
  createDiscoveryNeighborhoodSignalFacade,
  createWp2DiscoveryNeighborhoodStrategyRegistry,
  selectDiscoveryNeighborhood,
  type DiscoveryAnchoredSemanticNeighborhoodPortV1,
  type DiscoveryAnchoredSemanticNeighborhoodV1,
  type DiscoveryNeighborhoodSignalBundleV1,
  type DiscoveryNeighborhoodStrategyV1,
} from '../../modules/discovery-finding-fingerprint/src/index.js';
import {
  DiscoveryWorkBudgetLedgerV1,
  type DiscoveryWorkBudgetV1,
} from '../../modules/discovery-quality-gate/src/index.js';

const budget = (overrides: Partial<DiscoveryWorkBudgetV1> = {}): DiscoveryWorkBudgetV1 => ({
  schemaVersion: '1.0.0',
  budgetVersion: 'discovery-work-budget:v1',
  maxResources: 100,
  maxSemanticNeighbors: 100,
  maxCandidatePairs: 100,
  maxCandidateGroups: 100,
  maxFindings: 100,
  maxProviderCalls: 10,
  maxInputTokens: 10_000,
  maxOutputTokens: 10_000,
  maxOutputTokensPerCall: 1_000,
  maxEstimatedCostMicros: 10_000,
  maxConcurrentProviderCalls: 2,
  deadlineAt: '2099-01-01T00:00:00.000Z',
  ...overrides,
});

const context = (
  budgetPort?: DiscoverySignalReadContextV1['budget'],
  overrides: Partial<DiscoverySignalReadContextV1> = {},
): DiscoverySignalReadContextV1 => ({
  schemaVersion: '1.0.0',
  projectId: 'project-1',
  accessScope: ['project:read'],
  sensitivity: 'internal',
  canonicalBase: {
    schemaVersion: '1.0.0',
    canonicalVersion: 7,
    snapshotDigest: 'canonical-7',
  },
  discoveryBase: {
    schemaVersion: '1.0.0',
    projectionRevision: 'discovery-7',
    projectionDigest: 'discovery-7',
  },
  sourceProjectionDigest: 'sources-7',
  bounds: {
    maxResourcesRead: 100,
    maxObservationsReturned: 100,
    maxFindingsEmitted: 100,
  },
  ...(budgetPort === undefined ? {} : { budget: budgetPort }),
  ...overrides,
});

const signal = (resourceId: string): DiscoverySignalResourceV1 => ({
  resource: {
    schemaVersion: '1.0.0',
    resourceKind: 'CANONICAL_ENTITY',
    resourceId,
    projectId: 'project-1',
    resourceState: 'APPROVED',
    resourceRevision: '1',
  },
  label: resourceId,
  evidenceIds: [],
  security: {
    projectId: 'project-1',
    accessScope: ['project:read'],
    sensitivity: 'internal',
  },
});

const emptyWp1Ports = (): DiscoverySignalPortsV1 => ({
  compiledTruth: {
    read: vi.fn(async () => ({
      resources: [],
      sourceProjectionDigest: 'sources-7',
      completeness: 'COMPLETE' as const,
    })),
  },
  hybridRetrieval: {
    read: vi.fn(async () => ({ resources: [], ranks: {}, completeness: 'COMPLETE' as const })),
  },
  graph: { read: vi.fn(async () => ({ edges: [], completeness: 'COMPLETE' as const })) },
  temporalConflict: {
    read: vi.fn(async () => ({ observations: [], completeness: 'COMPLETE' as const })),
  },
  evidenceCoverage: {
    read: vi.fn(async () => ({ resources: [], completeness: 'COMPLETE' as const })),
  },
});

const wp1Dependencies = (findingFactory = vi.fn((input) => `finding-${input.candidateIndex}`)) => ({
  runId: 'run-1',
  clock: { now: () => '2026-08-30T00:00:00.000Z' },
  findingIdFactory: findingFactory,
});

const wp2Strategy = (target: DiscoveryNeighborhoodStrategyV1['targetFindingType']) => {
  const strategy = createWp2DiscoveryNeighborhoodStrategyRegistry()
    .list()
    .find((entry) => entry.targetFindingType === target);
  if (!strategy) throw new Error(`Missing WP2 strategy: ${target}`);
  return strategy;
};

const neighborhoodBase = (generation = 'generation-1') => ({
  sourceProjectionDigest: 'sources-7',
  canonicalBase: {
    schemaVersion: '1.0.0' as const,
    canonicalVersion: 7,
    snapshotDigest: 'canonical-7',
  },
  discoveryBase: {
    schemaVersion: '1.0.0' as const,
    projectionRevision: 'discovery-7',
    projectionDigest: 'discovery-7',
  },
  semanticGenerationId: generation,
});

const semanticNeighborhood = (
  anchor: DiscoverySignalResourceV1,
  neighbors: readonly DiscoverySignalResourceV1[],
): DiscoveryAnchoredSemanticNeighborhoodV1 => ({
  ...neighborhoodBase(),
  anchor,
  neighbors: neighbors.map((resource, index) => ({
    ...neighborhoodBase(),
    resource,
    semanticRank: index + 1,
  })),
  completeness: 'COMPLETE',
});

const neighborhoodPort = (
  resultFor: (anchor: DiscoverySignalResourceV1) => DiscoveryAnchoredSemanticNeighborhoodV1,
): DiscoveryAnchoredSemanticNeighborhoodPortV1 => ({
  read: vi.fn(async ({ anchor }) => resultFor(anchor)),
});

const bundle = (
  semanticNeighborhoods: readonly DiscoveryAnchoredSemanticNeighborhoodV1[],
  budgetPort?: DiscoverySignalReadContextV1['budget'],
): DiscoveryNeighborhoodSignalBundleV1 => ({
  context: context(budgetPort),
  anchors: semanticNeighborhoods.map((entry) => entry.anchor),
  semanticNeighborhoods,
  completeness: 'COMPLETE',
});

describe('AKP-3 WP4 non-provider budget propagation', () => {
  it('shares distinct resource identity across actual WP1 and WP2 paths', async () => {
    const a = signal('a');
    const b = signal('b');
    const c = signal('c');
    const d = signal('d');
    const ledger = new DiscoveryWorkBudgetLedgerV1(budget({ maxResources: 3 }));
    const wp1Ports = emptyWp1Ports();
    wp1Ports.evidenceCoverage.read = vi.fn(async () => ({
      resources: [a, b],
      completeness: 'COMPLETE' as const,
    }));
    const wp1Strategy = createWp1DiscoveryStrategyRegistry().get(
      'akp-3.evidence-gap.absent-lineage',
      '1.0.0',
    )!;
    await createDiscoverySignalFacade(wp1Ports).readForStrategy(context(ledger), wp1Strategy);
    expect(ledger.snapshot().resources).toBe(2);

    const port = neighborhoodPort((anchor) => semanticNeighborhood(anchor, [b, c, d]));
    const result = await createDiscoveryNeighborhoodSignalFacade({
      semanticNeighborhood: port,
    }).readForStrategy({
      context: context(ledger),
      anchors: [a],
      strategy: wp2Strategy('PATTERN_HYPOTHESIS'),
    });

    expect(
      result.semanticNeighborhoods[0]?.neighbors.map((entry) => entry.resource.resource.resourceId),
    ).toEqual(['b', 'c']);
    expect(result.semanticNeighborhoods[0]?.neighbors).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ resource: d })]),
    );
    expect(result.completeness).toBe('TRUNCATED');
    expect(result.budget?.reason).toBe('RESOURCE_LIMIT');
    expect(ledger.snapshot()).toMatchObject({ resources: 3, semanticNeighbors: 2 });

    const selection = selectDiscoveryNeighborhood(wp2Strategy('PATTERN_HYPOTHESIS'), result);
    expect(selection.budget?.reason).toBe('RESOURCE_LIMIT');
    expect(selection.candidates.flatMap((candidate) => candidate.memberResourceRefs)).not.toEqual(
      expect.arrayContaining([d.resource]),
    );
  });

  it('admits only the deterministic resource prefix before WP1 strategy processing', async () => {
    const resources = ['a', 'b', 'c', 'd', 'e'].map(signal);
    const ledger = new DiscoveryWorkBudgetLedgerV1(budget({ maxResources: 2 }));
    const ports = emptyWp1Ports();
    ports.compiledTruth.read = vi.fn(async () => ({
      resources,
      sourceProjectionDigest: 'sources-7',
      completeness: 'COMPLETE' as const,
    }));
    let seenResources: readonly DiscoverySignalResourceV1[] = [];
    const strategy: DiscoveryStrategyV1 = {
      strategyId: 'test.compiled-truth-budget',
      strategyVersion: '1.0.0',
      supportedFindingTypes: ['KNOWLEDGE_GAP'],
      requiredSignalKinds: ['COMPILED_TRUTH'],
      aiRequirement: 'NONE',
      work: { maxResourcesRead: 100, maxObservationsReturned: 100, maxFindingsEmitted: 100 },
      generate: async ({ signals }) => {
        seenResources = signals.compiledTruth?.resources ?? [];
        return [];
      },
    };
    const result = await createDiscoveryEngine({
      facade: createDiscoverySignalFacade(ports),
      registry: new DiscoveryStrategyRegistry([strategy]),
    }).generateBudgeted({
      context: context(ledger),
      dependencies: wp1Dependencies(),
    });

    expect(seenResources.map((entry) => entry.resource.resourceId)).toEqual(['a', 'b']);
    expect(result).toMatchObject({
      findings: [],
      completion: 'PARTIAL',
      truncation: { truncated: true, reason: 'RESOURCE_LIMIT' },
    });
    expect(ledger.snapshot().resources).toBe(2);
  });

  it('keeps semantic-neighbor and resource budgets independent across anchors', async () => {
    const anchors = [signal('a'), signal('b'), signal('c')];
    const port = neighborhoodPort((anchor) =>
      semanticNeighborhood(anchor, [signal('d'), signal('e')]),
    );
    const ledger = new DiscoveryWorkBudgetLedgerV1(
      budget({ maxResources: 100, maxSemanticNeighbors: 2 }),
    );
    const result = await createDiscoveryNeighborhoodSignalFacade({
      semanticNeighborhood: port,
    }).readForStrategy({
      context: context(ledger),
      anchors,
      strategy: wp2Strategy('PATTERN_HYPOTHESIS'),
    });

    expect(port.read).toHaveBeenCalledTimes(1);
    expect(result.semanticNeighborhoods).toHaveLength(1);
    expect(result.semanticNeighborhoods[0]?.neighbors).toHaveLength(2);
    expect(result.budget?.reason).toBe('SEMANTIC_NEIGHBOR_LIMIT');
    expect(ledger.snapshot()).toMatchObject({ resources: 5, semanticNeighbors: 2 });
  });

  it('returns exact candidate group and pair budget reasons from actual selectors', () => {
    const a = signal('a');
    const b = signal('b');
    const c = signal('c');
    const patternLedger = new DiscoveryWorkBudgetLedgerV1(budget({ maxCandidateGroups: 1 }));
    const pattern = wp2Strategy('PATTERN_HYPOTHESIS');
    const patternResult = selectDiscoveryNeighborhood(
      { ...pattern, work: { ...pattern.work, maxCandidateGroups: 10, maxCandidatePairs: 10 } },
      bundle([semanticNeighborhood(a, [b]), semanticNeighborhood(c, [b])], patternLedger),
    );
    expect(patternResult.candidates).toHaveLength(1);
    expect(patternResult.budget?.reason).toBe('CANDIDATE_GROUP_LIMIT');

    const relationLedger = new DiscoveryWorkBudgetLedgerV1(budget({ maxCandidatePairs: 1 }));
    const relation = wp2Strategy('RELATION_HYPOTHESIS');
    const relationNeighborhood = semanticNeighborhood(a, [b, c]);
    const relationSignals: DiscoveryNeighborhoodSignalBundleV1 = {
      ...bundle([relationNeighborhood], relationLedger),
      graphRelation: {
        ...neighborhoodBase(),
        relations: [],
        completeness: 'COMPLETE',
      },
      temporalCompatibility: {
        ...neighborhoodBase(),
        compatibilities: [
          { left: a.resource, right: b.resource, compatible: true, temporalEvidenceId: 't-b' },
          { left: a.resource, right: c.resource, compatible: true, temporalEvidenceId: 't-c' },
        ],
        completeness: 'COMPLETE',
      },
    };
    const relationResult = selectDiscoveryNeighborhood(
      { ...relation, work: { ...relation.work, maxCandidatePairs: 10, maxCandidateGroups: 10 } },
      relationSignals,
    );
    expect(relationResult.candidates).toHaveLength(1);
    expect(relationResult.budget?.reason).toBe('CANDIDATE_PAIR_LIMIT');
  });

  it('returns typed finding partial and does not materialize after finding denial', async () => {
    const first = signal('first');
    const second = signal('second');
    const ports = emptyWp1Ports();
    ports.evidenceCoverage.read = vi.fn(async () => ({
      resources: [first, second],
      completeness: 'COMPLETE' as const,
    }));
    const findingFactory = vi.fn(
      ({ candidateIndex, fingerprint }: { candidateIndex: number; fingerprint: string }) =>
        `finding-${candidateIndex}-${fingerprint.slice(0, 8)}`,
    );
    const ledger = new DiscoveryWorkBudgetLedgerV1(budget({ maxFindings: 1 }));
    const result = await createDiscoveryEngine({
      facade: createDiscoverySignalFacade(ports),
      registry: new DiscoveryStrategyRegistry([
        createWp1DiscoveryStrategyRegistry().get('akp-3.evidence-gap.absent-lineage', '1.0.0')!,
      ]),
    }).generateBudgeted({
      context: context(ledger),
      dependencies: wp1Dependencies(findingFactory),
    });

    expect(result.findings).toHaveLength(1);
    expect(result.completion).toBe('PARTIAL');
    expect(result.truncation).toEqual({ truncated: true, reason: 'FINDING_LIMIT' });
    expect(findingFactory).toHaveBeenCalledTimes(1);
    expect(ledger.snapshot().findings).toBe(1);
  });
});
