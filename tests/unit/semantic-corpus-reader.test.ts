import { describe, expect, it } from 'vitest';

import {
  type CanonicalClaim,
  type CanonicalSnapshot,
  type CompiledTruthProjection,
  type KnowledgeReviewGroup,
  SEMANTIC_REPRESENTATION_VERSION,
} from '../../packages/contracts/src/index.js';
import {
  type CanonicalKnowledgeReaderPort,
  type CompiledTruthReaderPort,
  type KnowledgeModelReaderPort,
  ProductSemanticCorpusReader,
} from '../../modules/hybrid-retrieval/src/index.js';

describe('AKP-1 WP4: ProductSemanticCorpusReader', () => {
  const projectId = 'proj-corpus-test';

  const mockClaim1: CanonicalClaim = {
    claimId: 'claim-1',
    projectId,
    revisionNumber: 1,
    claimText: 'Shotgun uses hybrid semantic retrieval.',
    sourceVersionId: 'sv-1',
    evidenceIds: ['ev-1', 'ev-2'],
    createdFromManifestId: null,
    authorityId: null,
    authorityDigest: null,
    accessScope: ['engineering', 'product'],
    sensitivity: 'internal',
    createdAt: '2026-08-18T10:00:00.000Z',
  };

  const mockClaim2: CanonicalClaim = {
    claimId: 'claim-2',
    projectId,
    revisionNumber: 1,
    claimText: 'Canonical claims remain the sole claim authority.',
    sourceVersionId: 'sv-2',
    evidenceIds: ['ev-3'],
    createdFromManifestId: null,
    authorityId: null,
    authorityDigest: null,
    accessScope: ['engineering'],
    sensitivity: 'public',
    createdAt: '2026-08-18T10:05:00.000Z',
  };

  const mockApprovedGroup: KnowledgeReviewGroup = {
    groupId: 'group-1',
    projectId,
    sourceVersionId: 'sv-1',
    revisionNumber: 1,
    status: 'APPROVED',
    contentDigest: 'sha256:' + 'a'.repeat(64),
    items: [
      {
        candidateId: 'entity-1',
        candidateType: 'ENTITY',
        revisionNumber: 1,
        sourceVersionId: 'sv-1',
        evidenceIds: ['ev-1'],
        modelOutputs: [],
        name: 'Shotgun Platform',
        entityKind: 'CONCEPT',
        aliases: ['Shotgun', 'Shotgun Core'],
        resolution: { status: 'NEW' },
      },
      {
        candidateId: 'relation-1',
        candidateType: 'RELATION',
        revisionNumber: 1,
        sourceVersionId: 'sv-1',
        evidenceIds: ['ev-1', 'ev-2'],
        modelOutputs: [],
        fromCandidateId: 'entity-1',
        toCandidateId: 'entity-2',
        relationType: 'USES',
        direction: 'DIRECTED',
      },
      {
        candidateId: 'event-1',
        candidateType: 'EVENT',
        revisionNumber: 1,
        sourceVersionId: 'sv-1',
        evidenceIds: ['ev-2'],
        modelOutputs: [],
        title: 'AKP-1 Launch Event',
        participantCandidateIds: ['entity-1'],
      },
      {
        candidateId: 'decision-1',
        candidateType: 'DECISION',
        revisionNumber: 1,
        sourceVersionId: 'sv-1',
        evidenceIds: ['ev-2'],
        modelOutputs: [],
        decisionText: 'Adopt pgvector for derived semantic projection.',
      },
      {
        // FACT candidate must be excluded from product eligibility!
        candidateId: 'fact-1',
        candidateType: 'FACT' as any,
        revisionNumber: 1,
        sourceVersionId: 'sv-1',
        evidenceIds: ['ev-1'],
        modelOutputs: [],
      } as any,
    ],
    decisions: [],
    accessScope: ['engineering'],
    sensitivity: 'internal',
    createdAt: '2026-08-18T10:00:00.000Z',
    updatedAt: '2026-08-18T10:00:00.000Z',
  };

  const mockPendingGroup: KnowledgeReviewGroup = {
    groupId: 'group-pending',
    projectId,
    sourceVersionId: 'sv-9',
    revisionNumber: 1,
    status: 'PENDING_REVIEW',
    contentDigest: 'sha256:' + 'b'.repeat(64),
    items: [
      {
        candidateId: 'entity-unapproved',
        candidateType: 'ENTITY',
        revisionNumber: 1,
        sourceVersionId: 'sv-9',
        evidenceIds: ['ev-9'],
        modelOutputs: [],
        name: 'Unapproved Candidate',
        entityKind: 'CONCEPT',
        aliases: [],
        resolution: { status: 'NEW' },
      },
    ],
    decisions: [],
    accessScope: ['engineering'],
    sensitivity: 'internal',
    createdAt: '2026-08-18T11:00:00.000Z',
    updatedAt: '2026-08-18T11:00:00.000Z',
  };

  const mockCanonicalKnowledge: CanonicalKnowledgeReaderPort = {
    getSnapshot: async (projId: string): Promise<CanonicalSnapshot> => ({
      snapshotId: 'snap-1',
      projectId: projId,
      version: 2,
      digest: 'sha256:' + 'c'.repeat(64),
      claims: [
        {
          claimId: 'claim-1',
          text: mockClaim1.claimText,
          revisionNumber: 1,
          evidenceIds: mockClaim1.evidenceIds,
        },
        {
          claimId: 'claim-2',
          text: mockClaim2.claimText,
          revisionNumber: 1,
          evidenceIds: mockClaim2.evidenceIds,
        },
      ],
      createdAt: '2026-08-18T10:10:00.000Z',
    }),
    findClaim: async (projId: string, claimId: string) => {
      if (claimId === 'claim-1') return mockClaim1;
      if (claimId === 'claim-2') return mockClaim2;
      return undefined;
    },
  };

  const mockKnowledgeModel: KnowledgeModelReaderPort = {
    listGroups: async () => [mockApprovedGroup, mockPendingGroup],
  };

  it('1. extracts exact product-eligible target corpus and excludes FACT and unapproved groups', async () => {
    const reader = new ProductSemanticCorpusReader(mockCanonicalKnowledge, mockKnowledgeModel);
    const corpus = await reader.readCorpus(projectId);

    expect(corpus.projectId).toBe(projectId);
    expect(corpus.canonicalBaseVersion).toBe(2);
    expect(corpus.totalItems).toBe(6); // 2 claims + 4 approved items (entity, relation, event, decision)

    const resourceTypes = corpus.items.map((i) => i.resourceType);
    expect(resourceTypes).toContain('CLAIM');
    expect(resourceTypes).toContain('ENTITY');
    expect(resourceTypes).toContain('RELATION');
    expect(resourceTypes).toContain('EVENT');
    expect(resourceTypes).toContain('DECISION');
    expect(resourceTypes).not.toContain('FACT');

    // Unapproved candidate is not present
    const resourceIds = corpus.items.map((i) => i.resourceId);
    expect(resourceIds).not.toContain('entity-unapproved');
    expect(resourceIds).not.toContain('fact-1');
  });

  it('2. enforces deterministic ordinal ordering across resource types and IDs', async () => {
    const reader = new ProductSemanticCorpusReader(mockCanonicalKnowledge, mockKnowledgeModel);
    const corpus = await reader.readCorpus(projectId);

    // Verify ordering: resourceType ASC, resourceId ASC
    for (let i = 1; i < corpus.items.length; i++) {
      const prev = corpus.items[i - 1]!;
      const curr = corpus.items[i]!;
      if (prev.resourceType === curr.resourceType) {
        expect(prev.resourceId < curr.resourceId).toBe(true);
      } else {
        expect(prev.resourceType < curr.resourceType).toBe(true);
      }
    }
  });

  it('3. does not resurrect missing Canonical Claim from Compiled Truth', async () => {
    const mockCompiledTruthWithMissingClaim: CompiledTruthReaderPort = {
      findProjection: async () => ({
        projectId,
        projectorVersion: 'v1',
        sourceSnapshotDigest: 'sha256:' + 'd'.repeat(64),
        logicalDigest: 'sha256:' + 'e'.repeat(64),
        canonicalVersion: 2,
        items: [
          {
            id: 'claim-ghost',
            type: 'CLAIM',
            label: 'A deleted claim that must not be resurrected',
            state: 'CURRENT',
            source: 'CANONICAL_CLAIM',
            evidenceIds: ['ev-ghost'],
            accessScope: ['engineering'],
            sensitivity: 'internal',
          },
          {
            id: 'entity-extra',
            type: 'ENTITY',
            label: 'Extra Entity',
            state: 'CURRENT',
            source: 'APPROVED_KNOWLEDGE',
            evidenceIds: ['ev-1'],
            accessScope: ['engineering'],
            sensitivity: 'internal',
          },
        ],
        graph: { nodes: [], edges: [], fallback: { available: true, modes: ['LIST', 'TABLE'] } },
        projectedAt: '2026-08-18T10:00:00.000Z',
        buildMode: 'FULL_REBUILD',
      }),
    };

    const reader = new ProductSemanticCorpusReader(
      mockCanonicalKnowledge,
      undefined,
      mockCompiledTruthWithMissingClaim,
    );
    const corpus = await reader.readCorpus(projectId);

    const resourceIds = corpus.items.map((i) => i.resourceId);
    expect(resourceIds).not.toContain('claim-ghost'); // Never resurrected!
    expect(resourceIds).toContain('entity-extra');
  });

  it('4. changes corpusDigest and sourceProjectionDigest when text, accessScope, sensitivity, or evidence changes', async () => {
    const readerBase = new ProductSemanticCorpusReader(mockCanonicalKnowledge, mockKnowledgeModel);
    const corpusBase = await readerBase.readCorpus(projectId);

    // Change claim text
    const modifiedClaimKnowledge: CanonicalKnowledgeReaderPort = {
      ...mockCanonicalKnowledge,
      findClaim: async (pId, claimId) => {
        if (claimId === 'claim-1') {
          return { ...mockClaim1, claimText: 'Modified statement about semantic retrieval.' };
        }
        return mockClaim2;
      },
    };
    const readerModText = new ProductSemanticCorpusReader(
      modifiedClaimKnowledge,
      mockKnowledgeModel,
    );
    const corpusModText = await readerModText.readCorpus(projectId);
    expect(corpusModText.corpusDigest).not.toBe(corpusBase.corpusDigest);
    expect(corpusModText.sourceProjectionDigest).not.toBe(corpusBase.sourceProjectionDigest);

    // Change sensitivity
    const modifiedSensKnowledge: CanonicalKnowledgeReaderPort = {
      ...mockCanonicalKnowledge,
      findClaim: async (pId, claimId) => {
        if (claimId === 'claim-1') {
          return { ...mockClaim1, sensitivity: 'restricted' };
        }
        return mockClaim2;
      },
    };
    const readerModSens = new ProductSemanticCorpusReader(
      modifiedSensKnowledge,
      mockKnowledgeModel,
    );
    const corpusModSens = await readerModSens.readCorpus(projectId);
    expect(corpusModSens.corpusDigest).not.toBe(corpusBase.corpusDigest);

    // Change evidenceIds
    const modifiedEvKnowledge: CanonicalKnowledgeReaderPort = {
      ...mockCanonicalKnowledge,
      findClaim: async (pId, claimId) => {
        if (claimId === 'claim-1') {
          return { ...mockClaim1, evidenceIds: ['ev-different'] };
        }
        return mockClaim2;
      },
    };
    const readerModEv = new ProductSemanticCorpusReader(modifiedEvKnowledge, mockKnowledgeModel);
    const corpusModEv = await readerModEv.readCorpus(projectId);
    expect(corpusModEv.corpusDigest).not.toBe(corpusBase.corpusDigest);
  });
});
