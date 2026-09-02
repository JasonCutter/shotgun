import type { AssetStoragePort } from '../../../modules/original-asset/src/index.js';
import {
  buildEvidenceCandidates,
  type EvidenceLocatorPort,
  type EvidenceRepositoryPort,
} from '../../../modules/evidence/src/index.js';
import type {
  DocumentTransformerPort,
  TransformationRepositoryPort,
} from '../../../modules/transformation/src/index.js';
import type { SourcesStage3PipelinePort } from '../../../modules/frontend-sources-write/src/index.js';

/**
 * FE-P5-XP Correction C — Source Intake → Stage 3 Transformation/Evidence
 * production pipeline (real adapters, no fixture bridging).
 *
 * Reads the staged Source bytes through the AssetStorage port, transforms the
 * immutable SourceVersion with the configured `DocumentTransformerPort`,
 * persists the Transformation Revision and indexes its Evidence candidates
 * with the real Stage 3 repositories. The pipeline is idempotent:
 * `TransformationRepositoryPort.save` reuses the stored revision for the same
 * SourceVersion/transformer output, and the evidence index upserts.
 */
export class SourcesStage3Pipeline implements SourcesStage3PipelinePort {
  constructor(
    private readonly deps: {
      readonly storage: AssetStoragePort;
      readonly transformer: DocumentTransformerPort;
      readonly locator: EvidenceLocatorPort;
      readonly transformationRepository: TransformationRepositoryPort;
      readonly evidenceRepository: EvidenceRepositoryPort;
    },
  ) {}

  async runForSourceVersion(
    input: Parameters<SourcesStage3PipelinePort['runForSourceVersion']>[0],
  ): Promise<void> {
    const bytes = await this.deps.storage.read(input.storageKey);
    // TextDecoder's default UTF-8 mode consumes a leading BOM. The original
    // asset hash is byte-addressed, so dropping that character makes the
    // document root hash disagree with the immutable SourceVersion hash.
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
    const sourceContentHash = input.contentHash;
    const output = await this.deps.transformer.transform({
      sourceId: input.sourceId,
      sourceVersionId: input.sourceVersionId,
      sourceContentHash,
      mediaType: input.mediaType,
      text,
    });
    const saved = await this.deps.transformationRepository.save({
      projectId: input.projectId,
      sourceId: input.sourceId,
      sourceVersionId: input.sourceVersionId,
      sourceContentHash,
      transformer: this.deps.transformer.identity,
      output,
      accessScope: [...input.accessScope],
      sensitivity: input.sensitivity,
      createdAt: new Date().toISOString(),
    });
    await this.deps.evidenceRepository.index(
      buildEvidenceCandidates(saved.revision, this.deps.locator),
    );
  }
}
