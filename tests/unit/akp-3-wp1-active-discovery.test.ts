import { describe, expect, it, vi } from 'vitest';

import {
  createDiscoveryEngine,
  createDiscoverySignalFacade,
  createWp1DiscoveryStrategyRegistry,
  DiscoverySignalFacade,
  DiscoveryStrategyRegistry,
  type DiscoverySignalPortsV1,
  type DiscoverySignalReadContextV1,
  type DiscoverySignalResourceV1,
} from '../../modules/discovery-finding-fingerprint/src/index.js';

const context = (
  overrides: Partial<DiscoverySignalReadContextV1> = {},
): DiscoverySignalReadContextV1 => ({
  schemaVersion: '1.0.0',
  projectId: 'project-1',
  accessScope: ['project:read', 'project:source'],
  sensitivity: 'internal',
  canonicalBase: {
    schemaVersion: '1.0.0',
    canonicalVersion: 7,
    snapshotDigest: 'canonical-snapshot-7',
  },
  discoveryBase: {
    schemaVersion: '1.0.0',
    projectionRevision: 'compiled-truth:v1',
    projectionDigest: 'projection-7',
  },
  sourceProjectionDigest: 'source-projection-7',
  bounds: {
    maxResourcesRead: 10,
    maxObservationsReturned: 10,
    maxFindingsEmitted: 10,
  },
  ...overrides,
});

const resource = (
  resourceId: string,
  overrides: Partial<DiscoverySignalResourceV1> = {},
): DiscoverySignalResourceV1 => ({
  resource: {
    schemaVersion: '1.0.0',
    resourceKind: 'CANONICAL_ENTITY',
    resourceId,
    projectId: 'project-1',
    resourceState: 'APPROVED',
    resourceRevision: '3',
  },
  label: resourceId,
  evidenceIds: [],
  security: {
    projectId: 'project-1',
    accessScope: ['project:read'],
    sensitivity: 'internal',
  },
  ...overrides,
});

const emptyPorts = (): DiscoverySignalPortsV1 => ({
  compiledTruth: {
    read: vi.fn(async () => ({
      resources: [],
      sourceProjectionDigest: 'source-projection-7',
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

const dependencies = (runId: string, now: string, prefix: string) => ({
  runId,
  clock: { now: () => now },
  findingIdFactory: ({
    candidateIndex,
    fingerprint,
  }: {
    candidateIndex: number;
    fingerprint: string;
  }) => `${prefix}-${candidateIndex}-${fingerprint.slice(0, 8)}`,
});

describe('AKP-3 WP1 signal facade and deterministic discovery', () => {
  it('passes the exact authorized context and calls only declared signal ports', async () => {
    const ports = emptyPorts();
    const compiledRead = vi.mocked(ports.compiledTruth.read);
    const graphRead = vi.mocked(ports.graph.read);
    const facade = createDiscoverySignalFacade(ports);
    const strategy = createWp1DiscoveryStrategyRegistry().get(
      'akp-3.knowledge-gap.isolated-entity',
      '1.0.0',
    )!;
    const authorizedContext = context();

    await facade.readForStrategy(authorizedContext, strategy);

    expect(compiledRead).toHaveBeenCalledWith(authorizedContext);
    expect(graphRead).toHaveBeenCalledWith(authorizedContext);
    expect(ports.hybridRetrieval.read).not.toHaveBeenCalled();
    expect(ports.temporalConflict.read).not.toHaveBeenCalled();
    expect(ports.evidenceCoverage.read).not.toHaveBeenCalled();
  });

  it('requires positive finite bounds and uses locale-independent deterministic resource order', async () => {
    const ports = emptyPorts();
    ports.evidenceCoverage.read = vi.fn(async () => ({
      resources: [resource('\ufffd'), resource('\ue000'), resource('a')],
      completeness: 'COMPLETE' as const,
    }));
    const facade = new DiscoverySignalFacade(ports);
    const strategy = createWp1DiscoveryStrategyRegistry().get(
      'akp-3.evidence-gap.absent-lineage',
      '1.0.0',
    )!;

    const result = await facade.readForStrategy(context(), strategy);
    expect(result.evidenceCoverage?.resources.map((entry) => entry.resource.resourceId)).toEqual([
      'a',
      '\ue000',
      '\ufffd',
    ]);
    await expect(
      facade.readForStrategy(
        context({
          bounds: { maxResourcesRead: 0, maxObservationsReturned: 1, maxFindingsEmitted: 1 },
        }),
        strategy,
      ),
    ).rejects.toThrow('positive finite integer');
  });

  it('fails closed for cross-project or inaccessible signal resources', async () => {
    const ports = emptyPorts();
    const inaccessible = resource('no-common-scope', {
      security: { projectId: 'project-1', accessScope: ['project:other'], sensitivity: 'internal' },
    });
    const crossProject = resource('cross-project', {
      resource: { ...resource('cross-project').resource, projectId: 'project-2' },
    });
    ports.evidenceCoverage.read = vi.fn(async () => ({
      resources: [inaccessible, crossProject],
      completeness: 'COMPLETE' as const,
    }));
    const result = await createDiscoverySignalFacade(ports).readForStrategy(
      context(),
      createWp1DiscoveryStrategyRegistry().get('akp-3.evidence-gap.absent-lineage', '1.0.0')!,
    );

    expect(result.evidenceCoverage?.resources).toEqual([]);
  });

  it('rejects duplicate, unsupported, and AI-enabled WP1 strategies deterministically', () => {
    const base = {
      strategyId: 'test',
      strategyVersion: '1.0.0',
      supportedFindingTypes: ['KNOWLEDGE_GAP'] as const,
      requiredSignalKinds: ['GRAPH'] as const,
      aiRequirement: 'NONE' as const,
      work: { maxResourcesRead: 1, maxObservationsReturned: 1, maxFindingsEmitted: 1 },
      generate: async () => [],
    };
    expect(() => new DiscoveryStrategyRegistry([base, base])).toThrow('Duplicate strategy');
    expect(
      () =>
        new DiscoveryStrategyRegistry([
          { ...base, supportedFindingTypes: ['RELATION_HYPOTHESIS'] as const },
        ]),
    ).toThrow('unsupported WP1 finding type');
    expect(
      () => new DiscoveryStrategyRegistry([{ ...base, aiRequirement: 'REQUIRED' as const }]),
    ).toThrow('deterministic strategies only');
  });

  it('emits one isolated Entity Knowledge Gap and preserves security, provenance, and fingerprint identity', async () => {
    const ports = emptyPorts();
    const entity = resource('entity-a', { label: 'Entity A' });
    ports.compiledTruth.read = vi.fn(async () => ({
      resources: [entity],
      sourceProjectionDigest: 'source-projection-7',
      completeness: 'COMPLETE' as const,
    }));
    const engine = createDiscoveryEngine({
      facade: createDiscoverySignalFacade(ports),
      registry: createWp1DiscoveryStrategyRegistry(),
    });
    const first = await engine.generate({
      context: context(),
      dependencies: dependencies('run-a', '2026-08-29T00:00:00.000Z', 'finding-a'),
    });
    const second = await engine.generate({
      context: context(),
      dependencies: dependencies('run-b', '2026-08-30T00:00:00.000Z', 'finding-b'),
    });

    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      findingType: 'KNOWLEDGE_GAP',
      status: 'DERIVED_INFERENCE',
      generationMethod: 'DETERMINISTIC',
      lifecycleState: 'NEW',
      projectId: 'project-1',
      accessScope: ['project:read'],
      sensitivity: 'internal',
      relatedResourceRefs: [entity.resource],
      evidenceIds: [],
      runId: 'run-a',
    });
    expect(first[0]?.payload).toMatchObject({ gapKind: 'MISSING_FACT' });
    expect(first[0]?.provenance).toMatchObject({
      kind: 'DETERMINISTIC',
      ruleId: 'akp-3.knowledge-gap.isolated-entity',
      ruleVersion: '1.0.0',
    });
    expect(second[0]?.fingerprint).toBe(first[0]?.fingerprint);
    expect(second[0]?.provenance).toMatchObject({
      kind: 'DETERMINISTIC',
      inputDigest:
        first[0]?.provenance.kind === 'DETERMINISTIC' ? first[0].provenance.inputDigest : '',
    });
  });

  it('does not emit a Knowledge Gap for an approved graph edge or a non-Entity', async () => {
    const ports = emptyPorts();
    const entityA = resource('entity-a');
    const entityB = resource('entity-b');
    ports.compiledTruth.read = vi.fn(async () => ({
      resources: [
        entityA,
        entityB,
        resource('claim-a', {
          resource: { ...resource('claim-a').resource, resourceKind: 'CANONICAL_CLAIM' },
        }),
      ],
      sourceProjectionDigest: 'source-projection-7',
      completeness: 'COMPLETE' as const,
    }));
    ports.graph.read = vi.fn(async () => ({
      edges: [
        {
          edgeId: 'edge-a',
          from: entityA,
          to: entityB,
          relationType: 'RELATED_TO',
        },
      ],
      completeness: 'COMPLETE' as const,
    }));
    const engine = createDiscoveryEngine({
      facade: createDiscoverySignalFacade(ports),
      registry: createDiscoveryStrategyRegistryFor('akp-3.knowledge-gap.isolated-entity'),
    });

    const result = await engine.generate({
      context: context(),
      dependencies: dependencies('run', '2026-08-29T00:00:00.000Z', 'finding'),
    });

    expect(result).toEqual([]);
  });

  it('does not infer isolated absence from an upstream-truncated graph result', async () => {
    const ports = emptyPorts();
    const entity = resource('entity-a');
    ports.compiledTruth.read = vi.fn(async () => ({
      resources: [entity],
      sourceProjectionDigest: 'source-projection-7',
      completeness: 'COMPLETE' as const,
    }));
    ports.graph.read = vi.fn(async () => ({
      edges: [],
      completeness: 'TRUNCATED' as const,
    }));
    const engine = createDiscoveryEngine({
      facade: createDiscoverySignalFacade(ports),
      registry: createDiscoveryStrategyRegistryFor('akp-3.knowledge-gap.isolated-entity'),
    });

    const result = await engine.generate({
      context: context(),
      dependencies: dependencies('run', '2026-08-29T00:00:00.000Z', 'finding'),
    });

    expect(result).toEqual([]);
  });

  it('marks facade-truncated graph reads and suppresses the isolated absence finding', async () => {
    const ports = emptyPorts();
    const entityA = resource('entity-a');
    const entityB = resource('entity-b');
    const otherA = resource('other-a');
    const otherB = resource('other-b');
    ports.compiledTruth.read = vi.fn(async () => ({
      resources: [entityA, entityB],
      sourceProjectionDigest: 'source-projection-7',
      completeness: 'COMPLETE' as const,
    }));
    ports.graph.read = vi.fn(async () => ({
      edges: [
        { edgeId: 'edge-1', from: otherA, to: otherB, relationType: 'RELATED_TO' },
        { edgeId: 'edge-2', from: entityA, to: entityB, relationType: 'RELATED_TO' },
      ],
      completeness: 'COMPLETE' as const,
    }));
    const boundedContext = context({
      bounds: { maxResourcesRead: 10, maxObservationsReturned: 1, maxFindingsEmitted: 10 },
    });
    const facade = createDiscoverySignalFacade(ports);
    const strategy = createWp1DiscoveryStrategyRegistry().get(
      'akp-3.knowledge-gap.isolated-entity',
      '1.0.0',
    )!;
    const signals = await facade.readForStrategy(boundedContext, strategy);
    expect(signals.graph?.completeness).toBe('TRUNCATED');
    expect(signals.graph?.edges).toHaveLength(1);

    const result = await createDiscoveryEngine({
      facade,
      registry: createDiscoveryStrategyRegistryFor('akp-3.knowledge-gap.isolated-entity'),
    }).generate({
      context: boundedContext,
      dependencies: dependencies('run', '2026-08-29T00:00:00.000Z', 'finding'),
    });
    expect(result).toEqual([]);
  });

  it('marks a facade-truncated resource read and suppresses isolated absence findings', async () => {
    const ports = emptyPorts();
    const entityA = resource('entity-a');
    const entityB = resource('entity-b');
    ports.compiledTruth.read = vi.fn(async () => ({
      resources: [entityA, entityB],
      sourceProjectionDigest: 'source-projection-7',
      completeness: 'COMPLETE' as const,
    }));
    const boundedContext = context({
      bounds: { maxResourcesRead: 1, maxObservationsReturned: 10, maxFindingsEmitted: 10 },
    });
    const facade = createDiscoverySignalFacade(ports);
    const strategy = createWp1DiscoveryStrategyRegistry().get(
      'akp-3.knowledge-gap.isolated-entity',
      '1.0.0',
    )!;
    const signals = await facade.readForStrategy(boundedContext, strategy);
    expect(signals.compiledTruth?.completeness).toBe('TRUNCATED');
    expect(signals.compiledTruth?.resources).toHaveLength(1);

    const result = await createDiscoveryEngine({
      facade,
      registry: createDiscoveryStrategyRegistryFor('akp-3.knowledge-gap.isolated-entity'),
    }).generate({
      context: boundedContext,
      dependencies: dependencies('run', '2026-08-29T00:00:00.000Z', 'finding'),
    });
    expect(result).toEqual([]);
  });

  it('uses typed graph identity so a same-ID Claim edge does not connect an Entity', async () => {
    const ports = emptyPorts();
    const entity = resource('shared-id');
    const claim = resource('shared-id', {
      resource: { ...resource('shared-id').resource, resourceKind: 'CANONICAL_CLAIM' },
    });
    const otherEntity = resource('other-entity');
    ports.compiledTruth.read = vi.fn(async () => ({
      resources: [entity],
      sourceProjectionDigest: 'source-projection-7',
      completeness: 'COMPLETE' as const,
    }));
    ports.graph.read = vi.fn(async () => ({
      edges: [{ edgeId: 'claim-edge', from: claim, to: otherEntity, relationType: 'MENTIONS' }],
      completeness: 'COMPLETE' as const,
    }));
    const result = await createDiscoveryEngine({
      facade: createDiscoverySignalFacade(ports),
      registry: createDiscoveryStrategyRegistryFor('akp-3.knowledge-gap.isolated-entity'),
    }).generate({
      context: context(),
      dependencies: dependencies('run', '2026-08-29T00:00:00.000Z', 'finding'),
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.relatedResourceRefs).toEqual([entity.resource]);
  });

  it('does not emit an Evidence Gap from a truncated coverage read', async () => {
    const ports = emptyPorts();
    const absent = resource('claim-without-evidence', {
      resource: { ...resource('claim-without-evidence').resource, resourceKind: 'CANONICAL_CLAIM' },
    });
    ports.evidenceCoverage.read = vi.fn(async () => ({
      resources: [absent],
      completeness: 'TRUNCATED' as const,
    }));
    const result = await createDiscoveryEngine({
      facade: createDiscoverySignalFacade(ports),
      registry: createDiscoveryStrategyRegistryFor('akp-3.evidence-gap.absent-lineage'),
    }).generate({
      context: context(),
      dependencies: dependencies('run', '2026-08-29T00:00:00.000Z', 'finding'),
    });

    expect(result).toEqual([]);
  });

  it('emits only ABSENT Evidence Gaps and never treats ranking as evidence quality', async () => {
    const ports = emptyPorts();
    const absent = resource('claim-without-evidence', {
      resource: { ...resource('claim-without-evidence').resource, resourceKind: 'CANONICAL_CLAIM' },
      label: 'Claim without evidence',
    });
    const supported = resource('claim-with-evidence', {
      resource: { ...resource('claim-with-evidence').resource, resourceKind: 'CANONICAL_CLAIM' },
      evidenceIds: ['evidence-1'],
      label: 'Claim with evidence',
    });
    ports.evidenceCoverage.read = vi.fn(async () => ({
      resources: [supported, absent],
      completeness: 'COMPLETE' as const,
    }));
    const engine = createDiscoveryEngine({
      facade: createDiscoverySignalFacade(ports),
      registry: createDiscoveryStrategyRegistryFor('akp-3.evidence-gap.absent-lineage'),
    });

    const result = await engine.generate({
      context: context(),
      dependencies: dependencies('run', '2026-08-29T00:00:00.000Z', 'finding'),
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ findingType: 'EVIDENCE_GAP', evidenceIds: [] });
    expect(result[0]?.payload).toMatchObject({
      coverageKind: 'ABSENT',
      affectedResourceRef: absent.resource,
    });
    expect(result[0]?.signalSummary).toEqual({ evidenceCoverage: 0 });
  });
});

const createDiscoveryStrategyRegistryFor = (strategyId: string): DiscoveryStrategyRegistry => {
  const all = createWp1DiscoveryStrategyRegistry();
  const strategy = all.list().find((entry) => entry.strategyId === strategyId);
  if (!strategy) throw new Error(`Missing test strategy: ${strategyId}`);
  return new DiscoveryStrategyRegistry([strategy]);
};
