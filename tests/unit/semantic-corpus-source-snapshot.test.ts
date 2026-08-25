import { describe, expect, it, vi } from 'vitest';

import {
  compiledTruthLogicalDigest,
  SEMANTIC_REPRESENTATION_VERSION,
  SEMANTIC_REPRESENTATION_VERSION_V2,
  semanticRepresentationBuilder,
  semanticRepresentationBuilderV2,
  type CanonicalClaim,
  type CanonicalSnapshot,
  type CompiledTruthProjection,
  type KnowledgeCandidate,
  type KnowledgeReviewGroup,
} from '../../packages/contracts/src/index.js';
import {
  buildSemanticCorpusSourceSnapshot,
  RepositorySemanticCorpusSourceSnapshotReader,
} from '../../modules/semantic-corpus/src/index.js';
import { PostgresSemanticCorpusSourceSnapshotReader } from '../../adapters/semantic-corpus-postgres/src/index.js';

const digest = (value: string): string => `sha256:${value.repeat(64).slice(0, 64)}`;

const canonical = (
  projectId = 'project-r2',
  claims: CanonicalSnapshot['claims'] = [],
): CanonicalSnapshot => ({
  snapshotId: `canonical:${projectId}:3`,
  projectId,
  version: 3,
  digest: digest('a'),
  claims,
  createdAt: '2026-08-20T10:00:00.000Z',
});

const canonicalClaim = (claimId: string, projectId = 'project-r2'): CanonicalClaim => ({
  claimId,
  projectId,
  revisionNumber: 1,
  claimText: `${claimId} is authoritative.`,
  sourceVersionId: `source:${claimId}`,
  evidenceIds: [`evidence:${claimId}`],
  createdFromManifestId: null,
  authorityId: null,
  authorityDigest: null,
  accessScope: ['owner'],
  sensitivity: 'public',
  createdAt: '2026-08-20T10:00:00.000Z',
});

const entity = (candidateId: string, name: string): KnowledgeCandidate => ({
  candidateId,
  candidateType: 'ENTITY',
  revisionNumber: 1,
  sourceVersionId: 'source:knowledge',
  evidenceIds: ['evidence:knowledge'],
  modelOutputs: [],
  name,
  entityKind: 'CONCEPT',
  aliases: ['Alias B', 'Alias A'],
  resolution: { status: 'NEW' },
});

const relation = (candidateId: string): KnowledgeCandidate => ({
  candidateId,
  candidateType: 'RELATION',
  revisionNumber: 1,
  sourceVersionId: 'source:knowledge',
  evidenceIds: ['evidence:relation'],
  modelOutputs: [],
  fromCandidateId: 'entity:one',
  toCandidateId: 'entity:two',
  relationType: 'RELATED_TO',
  direction: 'DIRECTED',
});

const event = (candidateId: string): KnowledgeCandidate => ({
  candidateId,
  candidateType: 'EVENT',
  revisionNumber: 1,
  sourceVersionId: 'source:knowledge',
  evidenceIds: ['evidence:event'],
  modelOutputs: [],
  title: 'A deterministic event',
  participantCandidateIds: ['entity:two', 'entity:one'],
  occurredAt: '2026-08-21T10:00:00.000Z',
});

const decision = (candidateId: string): KnowledgeCandidate => ({
  candidateId,
  candidateType: 'DECISION',
  revisionNumber: 1,
  sourceVersionId: 'source:knowledge',
  evidenceIds: ['evidence:decision'],
  modelOutputs: [],
  decisionText: 'Use the approved semantic representation.',
  actorCandidateId: 'entity:one',
});

const group = (
  items: readonly KnowledgeCandidate[],
  overrides: Partial<KnowledgeReviewGroup> = {},
): KnowledgeReviewGroup => ({
  groupId: 'group:r2',
  projectId: 'project-r2',
  sourceVersionId: 'source:knowledge',
  revisionNumber: 1,
  status: 'APPROVED',
  contentDigest: digest('b'),
  items,
  decisions: [],
  accessScope: ['owner'],
  sensitivity: 'internal',
  createdAt: '2026-08-20T10:00:00.000Z',
  updatedAt: '2026-08-20T11:00:00.000Z',
  ...overrides,
});

const build = (
  claims: readonly CanonicalClaim[],
  groups: readonly KnowledgeReviewGroup[],
  compiledTruth?: CompiledTruthProjection,
) => {
  const canonicalClaims = claims.map((claim) => ({
    claimId: claim.claimId,
    text: claim.claimText,
    revisionNumber: claim.revisionNumber,
    evidenceIds: claim.evidenceIds,
  }));
  return buildSemanticCorpusSourceSnapshot({
    projectId: 'project-r2',
    canonical: canonical('project-r2', canonicalClaims),
    claims,
    approvedGroups: groups,
    ...(compiledTruth === undefined
      ? {}
      : { compiledTruth: { status: 'READY' as const, projection: compiledTruth } }),
  });
};

const baseProjection = (
  sourceSnapshotDigest: string,
  items: CompiledTruthProjection['items'],
  canonicalVersion = 3,
): CompiledTruthProjection => ({
  projectId: 'project-r2',
  projectorVersion: '1.0.0',
  sourceSnapshotDigest,
  logicalDigest: compiledTruthLogicalDigest(items, []),
  canonicalVersion,
  items,
  graph: {
    nodes: items,
    edges: [],
    fallback: { available: true, modes: ['LIST', 'TABLE'] },
  },
  projectedAt: '2026-08-21T10:00:00.000Z',
  buildMode: 'FULL_REBUILD',
});

describe('AKP-1R R2 SemanticCorpusSourceSnapshot', () => {
  it('uses exactly the five Product resource types and excludes FACT', () => {
    const fact = {
      candidateId: 'fact:excluded',
      candidateType: 'FACT',
      revisionNumber: 1,
      sourceVersionId: 'source:fact',
      evidenceIds: ['evidence:fact'],
    } as unknown as KnowledgeCandidate;
    const snapshot = build(
      [canonicalClaim('claim:included')],
      [
        group([
          entity('entity:one', 'One'),
          entity('entity:two', 'Two'),
          relation('relation:one'),
          event('event:one'),
          decision('decision:one'),
          fact,
        ]),
      ],
    );
    expect(snapshot.resources.map((resource) => resource.resourceType)).toEqual([
      'DECISION',
      'ENTITY',
      'ENTITY',
      'EVENT',
      'RELATION',
      'CLAIM',
    ]);
    expect(
      snapshot.resources.some((resource) => (resource.resourceType as string) === 'FACT'),
    ).toBe(false);
  });

  it('produces the same source digest independent of row and item retrieval order', () => {
    const claim = canonicalClaim('claim:one');
    const first = build(
      [claim],
      [group([entity('entity:two', 'Two'), relation('relation:one'), entity('entity:one', 'One')])],
    );
    const second = build(
      [claim],
      [group([entity('entity:one', 'One'), relation('relation:one'), entity('entity:two', 'Two')])],
    );
    expect(second.sourceSnapshotDigest).toBe(first.sourceSnapshotDigest);
    expect(second.approvedKnowledgeDigest).toBe(first.approvedKnowledgeDigest);
    expect(second.resources.map((resource) => resource.representation.semanticText)).toEqual(
      first.resources.map((resource) => resource.representation.semanticText),
    );
  });

  it('changes the source digest on relevant source advancement and scopes resources to the target project', () => {
    const claim = canonicalClaim('claim:one');
    const first = build([claim], [group([entity('entity:one', 'One')])]);
    const advanced = build(
      [claim],
      [group([entity('entity:one', 'One')], { revisionNumber: 2, contentDigest: digest('c') })],
    );
    expect(advanced.sourceSnapshotDigest).not.toBe(first.sourceSnapshotDigest);

    const other = group([entity('entity:other', 'Other')], { projectId: 'other-project' });
    const scoped = build([claim, canonicalClaim('claim:other', 'other-project')], [other]);
    expect(scoped.resources.every((resource) => resource.resourceId !== 'claim:other')).toBe(true);
    expect(scoped.resources.every((resource) => resource.resourceId !== 'entity:other')).toBe(true);
  });

  it('preserves Canonical and Approved Knowledge provenance without conflating revisions', () => {
    const snapshot = build([canonicalClaim('claim:one')], [group([entity('entity:one', 'One')])]);
    const canonicalResource = snapshot.resources.find(
      (resource) => resource.authority === 'CANONICAL',
    )!;
    const approvedResource = snapshot.resources.find(
      (resource) => resource.authority === 'APPROVED_KNOWLEDGE',
    )!;
    expect(canonicalResource.provenance).toMatchObject({
      authority: 'CANONICAL',
      resourceRevision: 1,
      baseCanonicalVersion: 3,
    });
    expect(approvedResource.provenance).toMatchObject({
      authority: 'APPROVED_KNOWLEDGE',
      resourceRevision: 1,
      knowledgeGroupRevision: 1,
    });
    expect(approvedResource.provenance).not.toHaveProperty('baseCanonicalVersion');
  });

  it('allows only exact READY/matching Compiled Truth enrichment and never resurrects a missing Claim', () => {
    const claim = canonicalClaim('claim:one');
    const source = build([claim], [group([entity('entity:one', 'One')])]);
    const projection = baseProjection(source.sourceSnapshotDigest, [
      {
        id: 'claim:one',
        type: 'CLAIM',
        label: claim.claimText,
        state: 'CURRENT',
        source: 'CANONICAL_CLAIM',
        evidenceIds: claim.evidenceIds,
        accessScope: ['owner'],
        sensitivity: 'public',
      },
      {
        id: 'claim:deleted',
        type: 'CLAIM',
        label: 'stale deleted claim',
        state: 'CURRENT',
        source: 'CANONICAL_CLAIM',
        evidenceIds: ['evidence:deleted'],
        accessScope: ['owner'],
        sensitivity: 'public',
      },
      {
        id: 'entity:one',
        type: 'ENTITY',
        label: 'One',
        state: 'CURRENT',
        source: 'APPROVED_KNOWLEDGE',
        evidenceIds: ['evidence:knowledge'],
        accessScope: ['owner'],
        sensitivity: 'internal',
      },
    ]);
    const enriched = build([claim], [group([entity('entity:one', 'One')])], projection);
    const compiled = enriched.resources.filter(
      (resource) => resource.authority === 'COMPILED_TRUTH',
    );
    expect(compiled.map((resource) => resource.resourceId)).toEqual(['claim:one', 'entity:one']);
    expect(compiled.every((resource) => resource.provenance.authority === 'COMPILED_TRUTH')).toBe(
      true,
    );

    const stale = build([claim], [group([entity('entity:one', 'One')])], {
      ...projection,
      sourceSnapshotDigest: digest('z'),
    });
    expect(stale.resources.some((resource) => resource.authority === 'COMPILED_TRUTH')).toBe(false);

    const mismatchedVersion = build([claim], [group([entity('entity:one', 'One')])], {
      ...projection,
      canonicalVersion: 2,
    });
    expect(
      mismatchedVersion.resources.some((resource) => resource.authority === 'COMPILED_TRUTH'),
    ).toBe(false);
  });

  it('records deterministic dependency invalidation for referenced labels only', () => {
    const original = build(
      [],
      [
        group([
          entity('entity:one', 'One'),
          entity('entity:two', 'Two'),
          relation('relation:one'),
          event('event:one'),
          decision('decision:one'),
        ]),
      ],
    );
    const renamed = build(
      [],
      [
        group([
          entity('entity:one', 'Renamed One'),
          entity('entity:two', 'Two'),
          relation('relation:one'),
          event('event:one'),
          decision('decision:one'),
        ]),
      ],
    );
    const unrelated = build(
      [],
      [
        group([
          entity('entity:one', 'One'),
          entity('entity:two', 'Renamed Two'),
          relation('relation:one'),
          event('event:one'),
          decision('decision:one'),
        ]),
      ],
    );
    const representation = (snapshot: ReturnType<typeof build>, id: string) =>
      snapshot.resources.find((resource) => resource.resourceId === id)!.representation;
    expect(representation(renamed, 'relation:one').semanticTextDigest).not.toBe(
      representation(original, 'relation:one').semanticTextDigest,
    );
    expect(representation(renamed, 'event:one').semanticTextDigest).not.toBe(
      representation(original, 'event:one').semanticTextDigest,
    );
    expect(representation(renamed, 'decision:one').semanticTextDigest).not.toBe(
      representation(original, 'decision:one').semanticTextDigest,
    );
    expect(representation(unrelated, 'relation:one').semanticTextDigest).not.toBe(
      representation(original, 'relation:one').semanticTextDigest,
    );
    expect(representation(unrelated, 'decision:one').semanticTextDigest).toBe(
      representation(original, 'decision:one').semanticTextDigest,
    );
  });

  it('keeps v1 unchanged and exposes v2 as a distinct deterministic builder path', () => {
    const v1 = semanticRepresentationBuilder.buildClaim({
      resourceType: 'CLAIM',
      resourceId: 'claim:v1',
      statement: 'Stable v1 statement',
      subjectRef: 'entity:one',
    });
    const v2 = semanticRepresentationBuilderV2.build({
      resourceType: 'CLAIM',
      resourceId: 'claim:v1',
      statement: 'Stable v1 statement',
      stableSubjectRef: 'entity:one',
    });
    expect(v1.representationVersion).toBe(SEMANTIC_REPRESENTATION_VERSION);
    expect(v2.representationVersion).toBe(SEMANTIC_REPRESENTATION_VERSION_V2);
    expect(v1.semanticText).toContain('subject_ref: entity:one');
    expect(v2.semanticText).toContain('stable_subject_ref: entity:one');
  });

  it('emits deterministic human-semantic v2 payloads with stable references', () => {
    const first = semanticRepresentationBuilderV2.build({
      resourceType: 'ENTITY',
      resourceId: 'entity:one',
      entityType: 'CONCEPT',
      name: 'Project Shotgun',
      aliases: ['Shotgun', 'Project Shotgun', 'Shotgun'],
    });
    const second = semanticRepresentationBuilderV2.build({
      resourceType: 'ENTITY',
      resourceId: 'entity:one',
      entityType: 'CONCEPT',
      name: 'Project Shotgun',
      aliases: ['Project Shotgun', 'Shotgun'],
    });
    const relation = semanticRepresentationBuilderV2.build({
      resourceType: 'RELATION',
      resourceId: 'relation:one',
      relationType: 'OWNS',
      fromName: 'Project Shotgun',
      toName: 'Knowledge Base',
      stableFromRef: 'entity:one',
      stableToRef: 'entity:two',
    });
    const event = semanticRepresentationBuilderV2.build({
      resourceType: 'EVENT',
      resourceId: 'event:one',
      eventType: 'REVIEW',
      title: 'Architecture review',
      participants: [
        { name: 'Knowledge Base', stableRef: 'entity:two' },
        { name: 'Project Shotgun', stableRef: 'entity:one' },
      ],
    });
    const decision = semanticRepresentationBuilderV2.build({
      resourceType: 'DECISION',
      resourceId: 'decision:one',
      decisionType: 'ARCHITECTURE',
      decision: 'Use the approved source snapshot.',
      actorName: 'Project Shotgun',
      stableActorRef: 'entity:one',
    });

    expect(second.semanticTextDigest).toBe(first.semanticTextDigest);
    expect(first.semanticText).toContain('aliases: Project Shotgun, Shotgun');
    expect(relation.semanticText).toContain('from_name: Project Shotgun');
    expect(relation.semanticText).toContain('stable_from_ref: entity:one');
    expect(relation.semanticText).toContain('stable_to_ref: entity:two');
    expect(event.semanticText).toContain('participant_names: Project Shotgun, Knowledge Base');
    expect(event.semanticText).toContain('stable_participant_refs: entity:one, entity:two');
    expect(decision.semanticText).toContain('actor_name: Project Shotgun');
    expect(decision.semanticText).toContain('stable_actor_ref: entity:one');
  });

  it('reads a cheap watermark without resolving claims or constructing representations', async () => {
    const claim = canonicalClaim('claim:watermark');
    const canonicalRepository = {
      getSnapshot: vi.fn(async () =>
        canonical('project-r2', [
          {
            claimId: claim.claimId,
            text: claim.claimText,
            revisionNumber: 1,
            evidenceIds: claim.evidenceIds,
          },
        ]),
      ),
      findClaim: vi.fn(async () => {
        throw new Error('readWatermark must not resolve full claims');
      }),
    };
    const knowledgeRepository = {
      listGroups: vi.fn(async () => [group([entity('entity:watermark', 'Watermark')])]),
    };
    const reader = new RepositorySemanticCorpusSourceSnapshotReader(
      canonicalRepository as never,
      knowledgeRepository as never,
    );
    const watermark = await reader.readWatermark('project-r2');
    expect(watermark.sourceSnapshotDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(canonicalRepository.findClaim).not.toHaveBeenCalled();
  });
});

describe('AKP-1R R2 PostgreSQL source snapshot boundary', () => {
  it('uses one repeatable-read client transaction for Canonical, Knowledge and projection reads', async () => {
    const queries: string[] = [];
    const claim = canonicalClaim('claim:postgres');
    const groupValue = group([entity('entity:postgres', 'Postgres')]);
    const client = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.startsWith('SELECT version')) {
          return {
            rows: [
              {
                version: 3,
                snapshot_digest: digest('a'),
                updated_at: new Date('2026-08-20T10:00:00Z'),
              },
            ],
          };
        }
        if (sql.startsWith('SELECT claim_json')) return { rows: [{ claim_json: claim }] };
        if (sql.startsWith('SELECT project_id')) {
          return {
            rows: [
              {
                project_id: groupValue.projectId,
                group_id: groupValue.groupId,
                source_version_id: groupValue.sourceVersionId,
                revision_number: groupValue.revisionNumber,
                content_digest: groupValue.contentDigest,
                items: groupValue.items,
                access_scope: groupValue.accessScope,
                sensitivity: groupValue.sensitivity,
                created_at: new Date(groupValue.createdAt),
                updated_at: new Date(groupValue.updatedAt),
              },
            ],
          };
        }
        if (sql.startsWith('SELECT status')) return { rows: [] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client) };
    const reader = new PostgresSemanticCorpusSourceSnapshotReader(pool as never);
    const snapshot = await reader.readSnapshot('project-r2');
    expect(snapshot.projectId).toBe('project-r2');
    expect(queries[0]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(queries.at(-1)).toBe('COMMIT');
    expect(client.query).toHaveBeenCalledTimes(6);
    expect(client.release).toHaveBeenCalledOnce();
  });
});
