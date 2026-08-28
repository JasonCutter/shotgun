import {
  type CanonicalClaim,
  type CompiledTruthProjection,
  type SemanticCorpusSourceSnapshot,
  type SemanticCorpusSourceSnapshotReaderPort,
  type SemanticCorpusSourceWatermark,
} from '../../../packages/contracts/src/index.js';
import {
  buildSemanticCorpusSourceSnapshot,
  buildSemanticCorpusWatermark,
} from '../../../modules/semantic-corpus/src/index.js';
import type { CanonicalKnowledgeRepositoryPort } from '../../../modules/canonical-knowledge/src/index.js';
import type { KnowledgeModelRepositoryPort } from '../../../modules/knowledge-model/src/index.js';

type SemanticCorpusCompiledTruthReaderPort = {
  findProjection(projectId: string): Promise<CompiledTruthProjection | undefined>;
};

/**
 * Composes repository-owned source ports without making the semantic corpus
 * domain module depend on other domain modules.
 */
export class RepositorySemanticCorpusSourceSnapshotReader implements SemanticCorpusSourceSnapshotReaderPort {
  constructor(
    private readonly canonical: CanonicalKnowledgeRepositoryPort,
    private readonly knowledge: KnowledgeModelRepositoryPort,
    private readonly compiledTruth?: SemanticCorpusCompiledTruthReaderPort,
  ) {}

  async readSnapshot(projectId: string): Promise<SemanticCorpusSourceSnapshot> {
    const canonical = await this.canonical.getSnapshot(projectId);
    const claims = (
      await Promise.all(
        canonical.claims.map((claim) => this.canonical.findClaim(projectId, claim.claimId)),
      )
    ).filter((claim): claim is CanonicalClaim => claim !== undefined);
    const approvedGroups = await this.knowledge.listGroups(projectId);
    const projection = await this.compiledTruth?.findProjection(projectId);
    return buildSemanticCorpusSourceSnapshot({
      projectId,
      canonical,
      claims,
      approvedGroups,
      ...(projection === undefined
        ? {}
        : { compiledTruth: { status: 'READY' as const, projection } }),
    });
  }

  async readWatermark(projectId: string): Promise<SemanticCorpusSourceWatermark> {
    const canonical = await this.canonical.getSnapshot(projectId);
    const approvedGroups = await this.knowledge.listGroups(projectId);
    return buildSemanticCorpusWatermark({
      projectId,
      canonicalVersion: canonical.version,
      canonicalSnapshotDigest: canonical.digest,
      approvedGroups,
    });
  }
}
