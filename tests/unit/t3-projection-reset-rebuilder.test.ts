import { describe, expect, it, vi } from 'vitest';

import { createProjectProjectionResetRebuilder } from '../../adapters/source-knowledge-reset-postgres/src/projection-reset-rebuilder.js';
import type { KnowledgeResetOwnerContext } from '../../modules/source-knowledge-reset/src/index.js';
import type { SemanticCorpusSourceSnapshotReaderPort } from '../../packages/contracts/src/index.js';

const context: KnowledgeResetOwnerContext = {
  projectId: 'project-t3-reset',
  requestId: '7cfc4fd3-4fb0-4e18-9ec4-918340f6c2e2',
  knowledgeEpoch: 2,
  manifestDigest: `sha256:${'c'.repeat(64)}`,
};

const createReader = (
  input: {
    projectId?: string;
    sourceDigest?: string;
    watermarkSourceDigest?: string;
  } = {},
) => {
  const projectId = input.projectId ?? context.projectId;
  const sourceDigest = input.sourceDigest ?? `sha256:${'b'.repeat(64)}`;
  const watermarkSourceDigest = input.watermarkSourceDigest ?? sourceDigest;
  return {
    readSnapshot: vi.fn(async () => ({
      projectId,
      canonicalVersion: 9,
      canonicalSnapshotDigest: `sha256:${'a'.repeat(64)}`,
      approvedKnowledgeDigest: `sha256:${'d'.repeat(64)}`,
      sourceSnapshotDigest: watermarkSourceDigest,
      effectiveAt: '2026-09-24T00:00:00.000Z',
      resources: [],
    })),
    readWatermark: vi.fn(async () => ({
      projectId,
      canonicalVersion: 9,
      canonicalSnapshotDigest: `sha256:${'a'.repeat(64)}`,
      approvedKnowledgeDigest: `sha256:${'d'.repeat(64)}`,
      sourceSnapshotDigest: sourceDigest,
    })),
  } as unknown as SemanticCorpusSourceSnapshotReaderPort;
};

describe('T3 production projection rebuilder', () => {
  it('persists a complete empty projection using the post-reset semantic watermark', async () => {
    const persist = vi.fn(async () => undefined);
    const rebuilder = createProjectProjectionResetRebuilder({
      readCanonicalSnapshot: async () => ({ claims: [], relations: [] }),
      readKnowledgeGroups: async () => [],
      semanticSourceReader: createReader(),
      persist,
      now: () => new Date('2026-09-24T01:02:03.000Z'),
    });

    await rebuilder.rebuildProjectProjections(context);

    expect(persist).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({
        context,
        searchDocuments: [],
        compiledProjection: expect.objectContaining({
          projectId: context.projectId,
          sourceSnapshotDigest: `sha256:${'b'.repeat(64)}`,
          canonicalVersion: 9,
          items: [],
          graph: {
            nodes: [],
            edges: [],
            fallback: { available: true, modes: ['LIST', 'TABLE'] },
          },
          projectedAt: '2026-09-24T01:02:03.000Z',
          buildMode: 'FULL_REBUILD',
        }),
      }),
    );
  });

  it.each([
    { label: 'Canonical claim', canonical: { claims: [{}], relations: [] }, groups: [] },
    { label: 'Canonical relation', canonical: { claims: [], relations: [{}] }, groups: [] },
    { label: 'Knowledge group', canonical: { claims: [], relations: [] }, groups: [{}] },
  ])('blocks when a $label remains after owner purge', async ({ canonical, groups }) => {
    const persist = vi.fn(async () => undefined);
    const rebuilder = createProjectProjectionResetRebuilder({
      readCanonicalSnapshot: async () => canonical,
      readKnowledgeGroups: async () => groups,
      semanticSourceReader: createReader(),
      persist,
    });

    await expect(rebuilder.rebuildProjectProjections(context)).rejects.toThrow(
      'Source-derived Canonical or approved Knowledge content remains after reset purge.',
    );
    expect(persist).not.toHaveBeenCalled();
  });

  it('blocks inconsistent semantic source snapshots before writing', async () => {
    const persist = vi.fn(async () => undefined);
    const rebuilder = createProjectProjectionResetRebuilder({
      readCanonicalSnapshot: async () => ({ claims: [], relations: [] }),
      readKnowledgeGroups: async () => [],
      semanticSourceReader: createReader({
        sourceDigest: `sha256:${'e'.repeat(64)}`,
        watermarkSourceDigest: `sha256:${'b'.repeat(64)}`,
      }),
      persist,
    });

    await expect(rebuilder.rebuildProjectProjections(context)).rejects.toThrow(
      'Source-derived Canonical or approved Knowledge content remains after reset purge.',
    );
    expect(persist).not.toHaveBeenCalled();
  });
});
