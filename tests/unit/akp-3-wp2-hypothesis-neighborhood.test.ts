import { describe, expect, it, vi } from 'vitest';

import {
  createDiscoveryNeighborhoodSignalFacade,
  createWp2DiscoveryNeighborhoodStrategyRegistry,
  selectDiscoveryNeighborhood,
  type DiscoveryAnchoredSemanticNeighborhoodPortV1,
  type DiscoveryAnchoredSemanticNeighborhoodV1,
  type DiscoveryCompetingResourceV1,
  type DiscoveryCompetingResourceSignalV1,
  type DiscoveryExistingCanonicalConflictSignalV1,
  type DiscoveryExistingGraphRelationSignalV1,
  type DiscoveryNeighborhoodBoundsV1,
  type DiscoveryNeighborhoodSignalBundleV1,
  type DiscoveryNeighborhoodStrategyV1,
  type DiscoverySignalReadContextV1,
  type DiscoverySignalResourceV1,
  type DiscoveryTemporalCompatibilitySignalV1,
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
    maxResourcesRead: 100,
    maxObservationsReturned: 100,
    maxFindingsEmitted: 100,
  },
  ...overrides,
});

const ref = (
  resourceId: string,
  overrides: Partial<DiscoverySignalResourceV1['resource']> = {},
): DiscoverySignalResourceV1['resource'] => ({
  schemaVersion: '1.0.0',
  resourceKind: 'CANONICAL_ENTITY',
  resourceId,
  projectId: 'project-1',
  resourceState: 'APPROVED',
  resourceRevision: '1',
  ...overrides,
});

const signal = (
  resourceId: string,
  overrides: Partial<DiscoverySignalResourceV1> = {},
): DiscoverySignalResourceV1 => ({
  resource: ref(resourceId),
  label: resourceId,
  evidenceIds: [],
  security: {
    projectId: 'project-1',
    accessScope: ['project:read'],
    sensitivity: 'internal',
  },
  ...overrides,
});

const base = (generation = 'generation-1') => ({
  sourceProjectionDigest: 'source-projection-7',
  canonicalBase: {
    schemaVersion: '1.0.0' as const,
    canonicalVersion: 7,
    snapshotDigest: 'canonical-snapshot-7',
  },
  discoveryBase: {
    schemaVersion: '1.0.0' as const,
    projectionRevision: 'compiled-truth:v1',
    projectionDigest: 'projection-7',
  },
  semanticGenerationId: generation,
});

const neighbor = (
  resource: DiscoverySignalResourceV1,
  rank = 1,
  generation = 'generation-1',
  overrides: Partial<DiscoveryAnchoredSemanticNeighborhoodV1> = {},
) => ({
  ...base(generation),
  resource,
  semanticRank: rank,
  ...overrides,
});

const neighborhood = (
  anchor: DiscoverySignalResourceV1,
  neighbors: readonly ReturnType<typeof neighbor>[],
  overrides: Partial<DiscoveryAnchoredSemanticNeighborhoodV1> = {},
): DiscoveryAnchoredSemanticNeighborhoodV1 => ({
  ...base(),
  anchor,
  neighbors,
  completeness: 'COMPLETE',
  ...overrides,
});

const graph = (
  relations: DiscoveryExistingGraphRelationSignalV1['relations'] = [],
  completeness: 'COMPLETE' | 'TRUNCATED' = 'COMPLETE',
): DiscoveryExistingGraphRelationSignalV1 => ({
  ...base(),
  relations,
  completeness,
});

const temporal = (
  compatibilities: DiscoveryTemporalCompatibilitySignalV1['compatibilities'] = [],
  completeness: 'COMPLETE' | 'TRUNCATED' = 'COMPLETE',
): DiscoveryTemporalCompatibilitySignalV1 => ({
  ...base(),
  compatibilities,
  completeness,
});

const competition = (
  competitions: DiscoveryCompetingResourceSignalV1['competitions'],
  completeness: 'COMPLETE' | 'TRUNCATED' = 'COMPLETE',
): DiscoveryCompetingResourceSignalV1 => ({
  ...base(),
  competitions,
  completeness,
});

const existingConflict = (
  conflicts: DiscoveryExistingCanonicalConflictSignalV1['conflicts'] = [],
  completeness: 'COMPLETE' | 'TRUNCATED' = 'COMPLETE',
): DiscoveryExistingCanonicalConflictSignalV1 => ({
  ...base(),
  conflicts,
  completeness,
});

const relationStrategy = (): DiscoveryNeighborhoodStrategyV1 => {
  const strategy = createWp2DiscoveryNeighborhoodStrategyRegistry()
    .list()
    .find((entry) => entry.targetFindingType === 'RELATION_HYPOTHESIS');
  if (!strategy) throw new Error('relation strategy missing');
  return strategy;
};

const patternStrategy = (): DiscoveryNeighborhoodStrategyV1 => {
  const strategy = createWp2DiscoveryNeighborhoodStrategyRegistry()
    .list()
    .find((entry) => entry.targetFindingType === 'PATTERN_HYPOTHESIS');
  if (!strategy) throw new Error('pattern strategy missing');
  return strategy;
};

const conflictStrategy = (): DiscoveryNeighborhoodStrategyV1 => {
  const strategy = createWp2DiscoveryNeighborhoodStrategyRegistry()
    .list()
    .find((entry) => entry.targetFindingType === 'CONFLICT_HYPOTHESIS');
  if (!strategy) throw new Error('conflict strategy missing');
  return strategy;
};

const bundle = (
  overrides: Partial<DiscoveryNeighborhoodSignalBundleV1> & {
    semanticNeighborhoods: readonly DiscoveryAnchoredSemanticNeighborhoodV1[];
  },
): DiscoveryNeighborhoodSignalBundleV1 => ({
  context: context(),
  anchors: overrides.semanticNeighborhoods.map((entry) => entry.anchor),
  completeness: 'COMPLETE',
  ...overrides,
});

const relationBundle = (
  neighborhoods: readonly DiscoveryAnchoredSemanticNeighborhoodV1[],
  overrides: Partial<DiscoveryNeighborhoodSignalBundleV1> = {},
): DiscoveryNeighborhoodSignalBundleV1 =>
  bundle({
    semanticNeighborhoods: neighborhoods,
    graphRelation: graph(),
    temporalCompatibility: temporal(),
    ...overrides,
  });

const select = (
  strategy: DiscoveryNeighborhoodStrategyV1,
  signals: DiscoveryNeighborhoodSignalBundleV1,
  bounds: DiscoveryNeighborhoodBoundsV1 = strategy.work,
) => selectDiscoveryNeighborhood({ ...strategy, work: bounds }, signals);

const semanticPort = (
  resultFor: (anchor: DiscoverySignalResourceV1) => DiscoveryAnchoredSemanticNeighborhoodV1,
): DiscoveryAnchoredSemanticNeighborhoodPortV1 => ({
  read: vi.fn(async ({ anchor }) => resultFor(anchor)),
});

describe('AKP-3 WP2 bounded hypothesis neighborhoods', () => {
  it('registers exactly three deterministic selectors with explicit positive bounds and no AI', () => {
    const strategies = createWp2DiscoveryNeighborhoodStrategyRegistry().list();

    expect(strategies).toHaveLength(3);
    expect(strategies.map((entry) => entry.targetFindingType)).toEqual([
      'CONFLICT_HYPOTHESIS',
      'PATTERN_HYPOTHESIS',
      'RELATION_HYPOTHESIS',
    ]);
    for (const strategy of strategies) {
      expect(strategy.aiRequirement).toBe('NONE');
      for (const value of Object.values(strategy.work)) expect(value).toBeGreaterThan(0);
    }
  });

  it('uses an explicit anchored semantic Port and never asks it for an unbounded result', async () => {
    const anchor = signal('anchor');
    const neighborSignal = signal('neighbor');
    const strategy = patternStrategy();
    const port = semanticPort((requestedAnchor) =>
      neighborhood(requestedAnchor, [neighbor(neighborSignal)]),
    );
    const facade = createDiscoveryNeighborhoodSignalFacade({
      semanticNeighborhood: port,
    });

    const result = await facade.readForStrategy({
      context: context(),
      anchors: [anchor],
      strategy,
    });

    expect(port.read).toHaveBeenCalledWith({ context: context(), anchor, limit: 20 });
    expect(result.semanticNeighborhoods).toHaveLength(1);
    expect(result.semanticNeighborhoods[0]?.neighbors[0]?.resource.resource.resourceId).toBe(
      'neighbor',
    );
  });

  it('keeps only semantically participating anchored neighbors, with deterministic UTF-16 ordering', () => {
    const anchor = signal('anchor');
    const umlaut = signal('ä-resource');
    const latin = signal('z-resource');
    const semantic = neighborhood(anchor, [neighbor(umlaut), neighbor(latin)]);
    const time = temporal([
      {
        left: anchor.resource,
        right: umlaut.resource,
        compatible: true,
        temporalEvidenceId: 't-a',
      },
      { left: anchor.resource, right: latin.resource, compatible: true, temporalEvidenceId: 't-z' },
    ]);

    const result = select(
      relationStrategy(),
      relationBundle([semantic], { temporalCompatibility: time }),
    );

    expect(
      result.candidates.map((candidate) => candidate.memberResourceRefs[1]?.resourceId),
    ).toEqual(['z-resource', 'ä-resource']);
    expect(result.candidates[0]?.selectionSignals[0]).toMatchObject({
      kind: 'SEMANTIC_NEIGHBOR',
      semanticRank: 1,
    });
  });

  it('does not create relation candidates from lexical-only or unanchored all-pairs data', () => {
    const anchor = signal('anchor');
    const lexicalOnly = {
      ...base(),
      resource: signal('lexical-only'),
      semanticRank: 1,
      lexicalRank: 1,
    };
    const noSemanticInput = relationBundle([neighborhood(anchor, [])], {
      temporalCompatibility: temporal([
        {
          left: anchor.resource,
          right: lexicalOnly.resource.resource,
          compatible: true,
          temporalEvidenceId: 't',
        },
      ]),
    });

    expect(select(relationStrategy(), noSemanticInput).candidates).toEqual([]);
  });

  it('requires same project, current/approved typed resources, and safe common security', () => {
    const anchor = signal('anchor');
    const crossProject = signal('cross-project', {
      resource: ref('cross-project', { projectId: 'project-2' }),
      security: { projectId: 'project-2', accessScope: ['project:read'], sensitivity: 'internal' },
    });
    const privateNeighbor = signal('private-neighbor', {
      security: {
        projectId: 'project-1',
        accessScope: ['project:private'],
        sensitivity: 'private',
      },
    });
    const time = temporal([
      {
        left: anchor.resource,
        right: crossProject.resource,
        compatible: true,
        temporalEvidenceId: 't-cross',
      },
      {
        left: anchor.resource,
        right: privateNeighbor.resource,
        compatible: true,
        temporalEvidenceId: 't-private',
      },
    ]);
    const result = select(
      relationStrategy(),
      relationBundle([neighborhood(anchor, [neighbor(crossProject), neighbor(privateNeighbor)])], {
        temporalCompatibility: time,
      }),
    );

    expect(result.candidates).toEqual([]);
  });

  it('preserves typed identity for same resource IDs, rejects self-pairs, and deduplicates A-B/B-A', () => {
    const entity = signal('same-id', {
      resource: ref('same-id', { resourceKind: 'CANONICAL_ENTITY' }),
    });
    const event = signal('same-id', {
      resource: ref('same-id', { resourceKind: 'CANONICAL_EVENT' }),
    });
    const self = signal('self');
    const time = temporal([
      {
        left: entity.resource,
        right: event.resource,
        compatible: true,
        temporalEvidenceId: 't-typed',
      },
      { left: self.resource, right: self.resource, compatible: true, temporalEvidenceId: 't-self' },
    ]);
    const result = select(
      relationStrategy(),
      relationBundle(
        [
          neighborhood(entity, [neighbor(event), neighbor(self)]),
          neighborhood(event, [neighbor(entity)]),
        ],
        { temporalCompatibility: time },
      ),
    );

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.memberResourceRefs.map((entry) => entry.resourceKind)).toEqual([
      'CANONICAL_ENTITY',
      'CANONICAL_EVENT',
    ]);
  });

  it('blocks relation candidates on a complete graph edge and does not infer absence from a truncated graph', () => {
    const anchor = signal('anchor');
    const other = signal('other');
    const semantic = neighborhood(anchor, [neighbor(other)]);
    const time = temporal([
      { left: anchor.resource, right: other.resource, compatible: true, temporalEvidenceId: 't' },
    ]);
    const relation = { from: anchor.resource, to: other.resource, relationType: 'supports' };

    expect(
      select(
        relationStrategy(),
        relationBundle([semantic], {
          graphRelation: graph([relation]),
          temporalCompatibility: time,
        }),
      ).candidates,
    ).toEqual([]);
    const truncated = select(
      relationStrategy(),
      relationBundle([semantic], {
        graphRelation: graph([relation], 'TRUNCATED'),
        temporalCompatibility: time,
      }),
    );
    expect(truncated.candidates).toEqual([]);
    expect(truncated.completeness).toBe('TRUNCATED');
  });

  it('marks relation selection truncated when neighbor or pair bounds are exhausted', () => {
    const anchor = signal('anchor');
    const first = signal('first');
    const second = signal('second');
    const semantic = neighborhood(anchor, [neighbor(first, 1), neighbor(second, 2)]);
    const time = temporal([
      { left: anchor.resource, right: first.resource, compatible: true, temporalEvidenceId: 't-1' },
      {
        left: anchor.resource,
        right: second.resource,
        compatible: true,
        temporalEvidenceId: 't-2',
      },
    ]);
    const bounded = select(
      relationStrategy(),
      relationBundle([semantic], { temporalCompatibility: time }),
      { ...relationStrategy().work, maxCandidatePairs: 1 },
    );

    expect(bounded.candidates).toHaveLength(1);
    expect(bounded.completeness).toBe('TRUNCATED');
  });

  it('creates an anchored pattern group with at least two members, order-independent dedup, and no final interpretation', () => {
    const a = signal('a');
    const b = signal('b');
    const c = signal('c');
    const signals = bundle({
      semanticNeighborhoods: [
        neighborhood(a, [neighbor(c), neighbor(b)]),
        neighborhood(b, [neighbor(a), neighbor(c)]),
      ],
    });

    const result = select(patternStrategy(), signals);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.memberResourceRefs.map((entry) => entry.resourceId)).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(result.candidates[0]).not.toHaveProperty('patternIdentity');
    expect(result.candidates[0]).not.toHaveProperty('patternStatement');
    expect(result.candidates[0]?.selectionSignals).toContainEqual({
      kind: 'ANCHOR_MEMBERSHIP',
      memberCount: 3,
    });
  });

  it('enforces pattern member/group bounds and preserves positive observations when truncated', () => {
    const a = signal('a');
    const b = signal('b');
    const c = signal('c');
    const strategy = patternStrategy();
    const result = select(
      strategy,
      bundle({ semanticNeighborhoods: [neighborhood(a, [neighbor(b), neighbor(c)])] }),
      { ...strategy.work, maxMembersPerGroup: 2 },
    );

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.memberResourceRefs).toHaveLength(2);
    expect(result.completeness).toBe('TRUNCATED');
  });

  it('rejects pattern members from another project or without common scope', () => {
    const a = signal('a');
    const crossProject = signal('cross', {
      resource: ref('cross', { projectId: 'project-2' }),
      security: { projectId: 'project-2', accessScope: ['project:read'], sensitivity: 'internal' },
    });
    const noScope = signal('no-scope', {
      security: {
        projectId: 'project-1',
        accessScope: ['project:private'],
        sensitivity: 'private',
      },
    });

    expect(
      select(
        patternStrategy(),
        bundle({ semanticNeighborhoods: [neighborhood(a, [neighbor(crossProject)])] }),
      ).candidates,
    ).toEqual([]);
    expect(
      select(
        patternStrategy(),
        bundle({ semanticNeighborhoods: [neighborhood(a, [neighbor(noScope)])] }),
      ).candidates,
    ).toEqual([]);
  });

  it('composes the highest sensitivity without widening access scope', () => {
    const a = signal('a');
    const b = signal('b', {
      security: { projectId: 'project-1', accessScope: ['project:read'], sensitivity: 'private' },
    });
    const result = select(
      patternStrategy(),
      bundle({ semanticNeighborhoods: [neighborhood(a, [neighbor(b)])] }),
    );

    expect(result.candidates[0]?.security).toMatchObject({
      accessScope: ['project:read'],
      sensitivity: 'private',
    });
  });

  it('requires explicit incompatibility for conflict candidates; similarity alone is insufficient', () => {
    const a = signal('a');
    const b = signal('b');
    const semantic = neighborhood(a, [neighbor(b)]);
    const common = {
      existingCanonicalConflict: existingConflict(),
    };
    expect(
      select(conflictStrategy(), bundle({ semanticNeighborhoods: [semantic], ...common }))
        .candidates,
    ).toEqual([]);

    const result = select(
      conflictStrategy(),
      bundle({
        semanticNeighborhoods: [semantic],
        ...common,
        competingResource: competition([
          {
            left: a.resource,
            right: b.resource,
            kind: 'FACTUAL',
            source: 'TYPED_PROPOSITION',
            signalId: 'competition-1',
          },
        ]),
      }),
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.selectionSignals).toContainEqual({
      kind: 'EXPLICIT_INCOMPATIBILITY',
      incompatibilityKind: 'FACTUAL',
      source: 'TYPED_PROPOSITION',
      signalId: 'competition-1',
    });
  });

  it('requires overlapping typed temporal evidence and rejects self or non-overlapping conflicts', () => {
    const a = signal('a');
    const b = signal('b');
    const semantic = neighborhood(a, [neighbor(b)]);
    const make = (temporalOverlap: boolean) =>
      select(
        conflictStrategy(),
        bundle({
          semanticNeighborhoods: [semantic],
          existingCanonicalConflict: existingConflict(),
          competingResource: competition([
            {
              left: a.resource,
              right: b.resource,
              kind: 'TEMPORAL',
              source: 'TEMPORAL_QUALIFICATION',
              signalId: `temporal-${temporalOverlap}`,
              temporalOverlap,
            },
          ]),
        }),
      );

    expect(make(false).candidates).toEqual([]);
    expect(make(true).candidates).toHaveLength(1);
  });

  it('suppresses an explicit existing Canonical Conflict pair, while a truncated signal never proves absence', () => {
    const a = signal('a');
    const b = signal('b');
    const semantic = neighborhood(a, [neighbor(b)]);
    const explicit = {
      participantResourceRefs: [a.resource, b.resource] as [typeof a.resource, typeof b.resource],
    };
    expect(
      select(
        conflictStrategy(),
        bundle({
          semanticNeighborhoods: [semantic],
          existingCanonicalConflict: existingConflict([explicit]),
          competingResource: competition([
            {
              left: a.resource,
              right: b.resource,
              kind: 'IDENTITY',
              source: 'IDENTITY_ASSIGNMENT',
              signalId: 'identity-1',
            },
          ]),
        }),
      ).candidates,
    ).toEqual([]);
    const truncated = select(
      conflictStrategy(),
      bundle({
        semanticNeighborhoods: [semantic],
        existingCanonicalConflict: existingConflict([], 'TRUNCATED'),
        competingResource: competition(
          [
            {
              left: a.resource,
              right: b.resource,
              kind: 'IDENTITY',
              source: 'IDENTITY_ASSIGNMENT',
              signalId: 'identity-1',
            },
          ],
          'TRUNCATED',
        ),
      }),
    );
    expect(truncated.candidates).toHaveLength(1);
    expect(truncated.completeness).toBe('TRUNCATED');
  });

  it('fails closed for incompatible semantic bases, missing required Ports, and invalid bounds', async () => {
    const anchor = signal('anchor');
    const other = signal('other');
    const incompatible = neighborhood(anchor, [neighbor(other)], {
      sourceProjectionDigest: 'other-projection',
    });
    const facade = createDiscoveryNeighborhoodSignalFacade({
      semanticNeighborhood: semanticPort(() => incompatible),
    });
    const missing = await facade.readForStrategy({
      context: context(),
      anchors: [anchor],
      strategy: relationStrategy(),
    });
    expect(missing.completeness).toBe('TRUNCATED');

    expect(() =>
      select(patternStrategy(), bundle({ semanticNeighborhoods: [neighborhood(anchor, [])] }), {
        ...patternStrategy().work,
        maxAnchors: 0,
      }),
    ).toThrow(/positive finite integer/);
  });

  it('marks facade output truncated when anchor or neighbor bounds are exhausted', async () => {
    const a = signal('a');
    const b = signal('b');
    const c = signal('c');
    const strategy = {
      ...patternStrategy(),
      work: { ...patternStrategy().work, maxAnchors: 1, maxNeighborsPerAnchor: 1 },
    };
    const port = semanticPort((anchor) => neighborhood(anchor, [neighbor(b), neighbor(c)]));
    const facade = createDiscoveryNeighborhoodSignalFacade({ semanticNeighborhood: port });
    const result = await facade.readForStrategy({
      context: context(),
      anchors: [a, b],
      strategy,
    });

    expect(result.anchors).toHaveLength(1);
    expect(result.semanticNeighborhoods[0]?.neighbors).toHaveLength(1);
    expect(result.completeness).toBe('TRUNCATED');
  });

  it('uses context resource bounds as the effective anchor and global resource authority', async () => {
    const a = signal('a');
    const b = signal('b');
    const c = signal('c');
    const d = signal('d');
    const strategy = {
      ...patternStrategy(),
      work: { ...patternStrategy().work, maxAnchors: 100, maxNeighborsPerAnchor: 20 },
    };
    const boundedContext = context({
      bounds: { maxResourcesRead: 3, maxObservationsReturned: 100, maxFindingsEmitted: 100 },
    });
    const port = semanticPort((anchor) =>
      neighborhood(
        anchor,
        anchor.resource.resourceId === 'a' ? [neighbor(c)] : [neighbor(c), neighbor(d)],
      ),
    );
    const facade = createDiscoveryNeighborhoodSignalFacade({ semanticNeighborhood: port });
    const result = await facade.readForStrategy({
      context: boundedContext,
      anchors: [a, b],
      strategy,
    });

    const exposed = new Set(
      result.semanticNeighborhoods.flatMap((entry) => [
        entry.anchor.resource.resourceId,
        ...entry.neighbors.map((neighborEntry) => neighborEntry.resource.resource.resourceId),
      ]),
    );
    expect(exposed.size).toBeLessThanOrEqual(3);
    expect(result.completeness).toBe('TRUNCATED');
    expect(port.read).toHaveBeenCalledTimes(1);
    expect(port.read).toHaveBeenCalledWith(expect.objectContaining({ limit: 1 }));
  });

  it('uses the smaller context anchor and semantic-neighbor limits', async () => {
    const a = signal('a');
    const b = signal('b');
    const c = signal('c');
    const strategy = {
      ...patternStrategy(),
      work: { ...patternStrategy().work, maxAnchors: 100, maxNeighborsPerAnchor: 20 },
    };
    const port = semanticPort((anchor) => neighborhood(anchor, []));
    const facade = createDiscoveryNeighborhoodSignalFacade({ semanticNeighborhood: port });
    const result = await facade.readForStrategy({
      context: context({
        bounds: { maxResourcesRead: 2, maxObservationsReturned: 100, maxFindingsEmitted: 100 },
      }),
      anchors: [a, b, c],
      strategy,
    });

    expect(result.anchors).toHaveLength(2);
    expect(port.read).not.toHaveBeenCalled();
    expect(result.completeness).toBe('TRUNCATED');

    const neighborPort = semanticPort((anchor) => neighborhood(anchor, [neighbor(b), neighbor(c)]));
    const neighborFacade = createDiscoveryNeighborhoodSignalFacade({
      semanticNeighborhood: neighborPort,
    });
    const neighborResult = await neighborFacade.readForStrategy({
      context: context({
        bounds: { maxResourcesRead: 100, maxObservationsReturned: 1, maxFindingsEmitted: 100 },
      }),
      anchors: [a],
      strategy,
    });
    expect(neighborPort.read).toHaveBeenCalledWith(expect.objectContaining({ limit: 1 }));
    expect(neighborResult.semanticNeighborhoods[0]?.neighbors).toHaveLength(1);
    expect(neighborResult.completeness).toBe('TRUNCATED');
  });

  it('bounds graph and temporal observations by context maxObservationsReturned', async () => {
    const a = signal('a');
    const b = signal('b');
    const c = signal('c');
    const d = signal('d');
    const semanticPortInstance = semanticPort((anchor) =>
      neighborhood(anchor, [neighbor(b), neighbor(c)]),
    );
    const graphRelations = [
      { from: a.resource, to: b.resource, relationType: 'supports' },
      { from: a.resource, to: c.resource, relationType: 'depends-on' },
      { from: a.resource, to: c.resource, relationType: 'supports' },
    ];
    const temporalObservations = [
      { left: a.resource, right: b.resource, compatible: true, temporalEvidenceId: 't-1' },
      { left: a.resource, right: c.resource, compatible: true, temporalEvidenceId: 't-2' },
      { left: a.resource, right: c.resource, compatible: false, temporalEvidenceId: 't-3' },
    ];
    const facade = createDiscoveryNeighborhoodSignalFacade({
      semanticNeighborhood: semanticPortInstance,
      graphRelation: { read: vi.fn(async () => graph(graphRelations)) },
      temporalCompatibility: { read: vi.fn(async () => temporal(temporalObservations)) },
    });
    const result = await facade.readForStrategy({
      context: context({
        bounds: { maxResourcesRead: 100, maxObservationsReturned: 2, maxFindingsEmitted: 100 },
      }),
      anchors: [a, d],
      strategy: relationStrategy(),
    });

    expect(result.graphRelation?.relations).toHaveLength(2);
    expect(result.temporalCompatibility?.compatibilities).toHaveLength(2);
    expect(result.graphRelation?.completeness).toBe('TRUNCATED');
    expect(result.temporalCompatibility?.completeness).toBe('TRUNCATED');
    expect(result.completeness).toBe('TRUNCATED');
  });

  it('bounds competing-resource and existing-conflict observations by the context authority', async () => {
    const a = signal('a');
    const b = signal('b');
    const c = signal('c');
    const d = signal('d');
    const semanticPortInstance = semanticPort((anchor) =>
      neighborhood(anchor, [neighbor(b), neighbor(c)]),
    );
    const competitions: DiscoveryCompetingResourceV1[] = [
      {
        left: a.resource,
        right: b.resource,
        kind: 'FACTUAL',
        source: 'TYPED_PROPOSITION',
        signalId: 'c-1',
      },
      {
        left: a.resource,
        right: c.resource,
        kind: 'IDENTITY',
        source: 'IDENTITY_ASSIGNMENT',
        signalId: 'c-2',
      },
      {
        left: a.resource,
        right: c.resource,
        kind: 'MODEL_DISAGREEMENT',
        source: 'EXPLICIT_CONFLICT_SIGNAL',
        signalId: 'c-3',
      },
    ];
    const conflicts = [
      {
        participantResourceRefs: [a.resource, b.resource] as [typeof a.resource, typeof b.resource],
      },
      {
        participantResourceRefs: [a.resource, c.resource] as [typeof a.resource, typeof c.resource],
      },
      {
        participantResourceRefs: [b.resource, c.resource] as [typeof b.resource, typeof c.resource],
      },
    ];
    const facade = createDiscoveryNeighborhoodSignalFacade({
      semanticNeighborhood: semanticPortInstance,
      competingResource: { read: vi.fn(async () => competition(competitions)) },
      existingCanonicalConflict: {
        read: vi.fn(async () => existingConflict(conflicts)),
      },
    });
    const result = await facade.readForStrategy({
      context: context({
        bounds: { maxResourcesRead: 100, maxObservationsReturned: 2, maxFindingsEmitted: 100 },
      }),
      anchors: [a, d],
      strategy: conflictStrategy(),
    });

    expect(result.competingResource?.competitions).toHaveLength(2);
    expect(result.existingCanonicalConflict?.conflicts).toHaveLength(2);
    expect(result.competingResource?.completeness).toBe('TRUNCATED');
    expect(result.existingCanonicalConflict?.completeness).toBe('TRUNCATED');
    expect(result.completeness).toBe('TRUNCATED');
  });

  it('validates direct selection bundles and rejects mismatched semantic bases or generations', () => {
    const a = signal('a');
    const b = signal('b');
    const semantic = neighborhood(a, [neighbor(b)]);
    const mismatchedProjection = neighborhood(a, [neighbor(b)], {
      sourceProjectionDigest: 'different-projection',
    });
    const mismatchedCanonical = neighborhood(a, [neighbor(b)], {
      canonicalBase: { ...base().canonicalBase, canonicalVersion: 8 },
    });
    const mismatchedDiscovery = neighborhood(a, [neighbor(b)], {
      discoveryBase: { ...base().discoveryBase, projectionDigest: 'different-discovery' },
    });

    expect(
      select(patternStrategy(), bundle({ semanticNeighborhoods: [mismatchedProjection] })),
    ).toMatchObject({
      candidates: [],
      completeness: 'TRUNCATED',
    });
    expect(
      select(patternStrategy(), bundle({ semanticNeighborhoods: [mismatchedCanonical] }))
        .candidates,
    ).toEqual([]);
    expect(
      select(patternStrategy(), bundle({ semanticNeighborhoods: [mismatchedDiscovery] }))
        .candidates,
    ).toEqual([]);

    const mismatchedGeneration = neighborhood(a, [neighbor(b, 1, 'generation-2')], {
      semanticGenerationId: 'generation-2',
    });
    expect(
      select(
        relationStrategy(),
        relationBundle([mismatchedGeneration], {
          graphRelation: graph(),
          temporalCompatibility: temporal([
            { left: a.resource, right: b.resource, compatible: true, temporalEvidenceId: 't' },
          ]),
        }),
      ).candidates,
    ).toEqual([]);
    expect(
      select(
        conflictStrategy(),
        bundle({
          semanticNeighborhoods: [mismatchedGeneration],
          competingResource: competition([
            {
              left: a.resource,
              right: b.resource,
              kind: 'FACTUAL',
              source: 'TYPED_PROPOSITION',
              signalId: 'c',
            },
          ]),
          existingCanonicalConflict: existingConflict(),
        }),
      ).candidates,
    ).toEqual([]);
    expect(
      select(patternStrategy(), bundle({ semanticNeighborhoods: [semantic] })).candidates,
    ).toHaveLength(1);
  });

  it('accepts only the four typed incompatibility kind/source pairings', () => {
    const a = signal('a');
    const b = signal('b');
    const semantic = neighborhood(a, [neighbor(b)]);
    const validMappings: readonly DiscoveryCompetingResourceV1[] = [
      {
        left: a.resource,
        right: b.resource,
        kind: 'FACTUAL',
        source: 'TYPED_PROPOSITION',
        signalId: 'f',
      },
      {
        left: a.resource,
        right: b.resource,
        kind: 'TEMPORAL',
        source: 'TEMPORAL_QUALIFICATION',
        signalId: 't',
        temporalOverlap: true,
      },
      {
        left: a.resource,
        right: b.resource,
        kind: 'IDENTITY',
        source: 'IDENTITY_ASSIGNMENT',
        signalId: 'i',
      },
      {
        left: a.resource,
        right: b.resource,
        kind: 'MODEL_DISAGREEMENT',
        source: 'EXPLICIT_CONFLICT_SIGNAL',
        signalId: 'm',
      },
    ];
    for (const mapping of validMappings) {
      expect(
        select(
          conflictStrategy(),
          bundle({
            semanticNeighborhoods: [semantic],
            competingResource: competition([mapping]),
            existingCanonicalConflict: existingConflict(),
          }),
        ).candidates,
      ).toHaveLength(1);
    }
  });

  it('rejects every cross-paired kind/source combination and malformed temporal signals at runtime', () => {
    const a = signal('a');
    const b = signal('b');
    const semantic = neighborhood(a, [neighbor(b)]);
    const invalidMappings = [
      { kind: 'FACTUAL', source: 'TEMPORAL_QUALIFICATION' },
      { kind: 'FACTUAL', source: 'IDENTITY_ASSIGNMENT' },
      { kind: 'FACTUAL', source: 'EXPLICIT_CONFLICT_SIGNAL' },
      { kind: 'TEMPORAL', source: 'TYPED_PROPOSITION', temporalOverlap: true },
      { kind: 'TEMPORAL', source: 'IDENTITY_ASSIGNMENT', temporalOverlap: true },
      { kind: 'TEMPORAL', source: 'EXPLICIT_CONFLICT_SIGNAL', temporalOverlap: true },
      { kind: 'IDENTITY', source: 'TYPED_PROPOSITION' },
      { kind: 'IDENTITY', source: 'TEMPORAL_QUALIFICATION' },
      { kind: 'IDENTITY', source: 'EXPLICIT_CONFLICT_SIGNAL' },
      { kind: 'MODEL_DISAGREEMENT', source: 'TYPED_PROPOSITION' },
      { kind: 'MODEL_DISAGREEMENT', source: 'TEMPORAL_QUALIFICATION' },
      { kind: 'MODEL_DISAGREEMENT', source: 'IDENTITY_ASSIGNMENT' },
    ];
    for (const [index, invalid] of invalidMappings.entries()) {
      const malformed = {
        left: a.resource,
        right: b.resource,
        signalId: `invalid-${index}`,
        ...invalid,
      } as unknown as DiscoveryCompetingResourceV1;
      const result = select(
        conflictStrategy(),
        bundle({
          semanticNeighborhoods: [semantic],
          competingResource: competition([malformed]),
          existingCanonicalConflict: existingConflict(),
        }),
      );
      expect(result.candidates).toEqual([]);
      expect(result.completeness).toBe('TRUNCATED');
    }
    const missingTemporalOverlap = {
      left: a.resource,
      right: b.resource,
      kind: 'TEMPORAL',
      source: 'TEMPORAL_QUALIFICATION',
      signalId: 'missing-overlap',
    } as unknown as DiscoveryCompetingResourceV1;
    const result = select(
      conflictStrategy(),
      bundle({
        semanticNeighborhoods: [semantic],
        competingResource: competition([missingTemporalOverlap]),
        existingCanonicalConflict: existingConflict(),
      }),
    );
    expect(result.candidates).toEqual([]);
    expect(result.completeness).toBe('TRUNCATED');
  });
});
