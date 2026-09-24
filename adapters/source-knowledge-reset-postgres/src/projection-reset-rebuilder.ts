import type { Pool } from 'pg';

import { PostgresCanonicalKnowledgeRepository } from '../../../adapters/postgres-stage6/src/index.js';
import { PostgresKnowledgeModelRepository } from '../../../adapters/postgres-stage9/src/index.js';
import { PostgresSemanticCorpusSourceSnapshotReader } from '../../../adapters/semantic-corpus-postgres/src/index.js';
import type { KnowledgeResetOwnerContext } from '../../../modules/source-knowledge-reset/src/index.js';
import { COMPILED_TRUTH_PROJECTOR_VERSION } from '../../../modules/compiled-truth/src/index.js';
import {
  compiledTruthLogicalDigest,
  type CompiledTruthProjection,
  type SemanticCorpusSourceSnapshotReaderPort,
} from '../../../packages/contracts/src/index.js';
import type { ProjectProjectionRebuilder } from './projection-owner.js';
import { PostgresProjectionResetSnapshotWriter } from './projection-owner.js';

/**
 * T3's reset result has no Source-derived Canonical claims, relations, or
 * approved Knowledge groups. Rebuild the normal empty Search/Compiled Truth
 * projection only after reading that complete post-purge state back.
 */
export const createProjectProjectionResetRebuilder = (input: {
  readonly readCanonicalSnapshot: (projectId: string) => Promise<{
    readonly claims: readonly unknown[];
    readonly relations?: readonly unknown[];
  }>;
  readonly readKnowledgeGroups: (projectId: string) => Promise<readonly unknown[]>;
  readonly semanticSourceReader: SemanticCorpusSourceSnapshotReaderPort;
  readonly persist: (input: {
    readonly context: KnowledgeResetOwnerContext;
    readonly searchDocuments: readonly [];
    readonly compiledProjection: CompiledTruthProjection;
  }) => Promise<void>;
  readonly now?: () => Date;
}): ProjectProjectionRebuilder => ({
  async rebuildProjectProjections(context) {
    const [canonical, groups, semanticSnapshot, watermark] = await Promise.all([
      input.readCanonicalSnapshot(context.projectId),
      input.readKnowledgeGroups(context.projectId),
      input.semanticSourceReader.readSnapshot(context.projectId),
      input.semanticSourceReader.readWatermark(context.projectId),
    ]);
    if (
      canonical.claims.length !== 0 ||
      (canonical.relations?.length ?? 0) !== 0 ||
      groups.length !== 0 ||
      semanticSnapshot.resources.length !== 0 ||
      semanticSnapshot.projectId !== context.projectId ||
      semanticSnapshot.sourceSnapshotDigest !== watermark.sourceSnapshotDigest ||
      semanticSnapshot.canonicalVersion !== watermark.canonicalVersion ||
      watermark.projectId !== context.projectId
    ) {
      throw new Error(
        'Source-derived Canonical or approved Knowledge content remains after reset purge.',
      );
    }
    const projectedAt = (input.now ?? (() => new Date()))().toISOString();
    const items: CompiledTruthProjection['items'] = [];
    const edges: CompiledTruthProjection['graph']['edges'] = [];
    const compiledProjection: CompiledTruthProjection = {
      projectId: context.projectId,
      projectorVersion: COMPILED_TRUTH_PROJECTOR_VERSION,
      sourceSnapshotDigest: watermark.sourceSnapshotDigest,
      logicalDigest: compiledTruthLogicalDigest(items, edges),
      canonicalVersion: watermark.canonicalVersion,
      items,
      graph: {
        nodes: [],
        edges,
        fallback: { available: true, modes: ['LIST', 'TABLE'] },
      },
      projectedAt,
      buildMode: 'FULL_REBUILD',
    };
    await input.persist({
      context,
      searchDocuments: [],
      compiledProjection,
    });
  },
});

export const createPostgresProjectProjectionResetRebuilder = (input: {
  readonly runtimePool: Pool;
  readonly executorPool: Pool;
}): ProjectProjectionRebuilder => {
  const canonical = new PostgresCanonicalKnowledgeRepository(input.runtimePool);
  const knowledge = new PostgresKnowledgeModelRepository(input.runtimePool);
  const semanticSourceReader = new PostgresSemanticCorpusSourceSnapshotReader(input.runtimePool);
  const writer = new PostgresProjectionResetSnapshotWriter(input.executorPool);
  return createProjectProjectionResetRebuilder({
    readCanonicalSnapshot: (projectId) => canonical.getSnapshot(projectId),
    readKnowledgeGroups: (projectId) => knowledge.listGroups(projectId),
    semanticSourceReader,
    persist: (projection) => writer.persist(projection),
  });
};
