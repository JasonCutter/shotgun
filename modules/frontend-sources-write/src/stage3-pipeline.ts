import type { SourcesSensitivity } from '../../../packages/contracts/src/index.js';

/**
 * FE-P5-XP Correction C — Source Intake → Stage 3 Transformation/Evidence
 * production wiring port.
 *
 * The Sources product service invokes this after a SourceVersion is
 * materialized by a successful intake, so the SAME SourceVersion flows through
 * the real production Transformation/Evidence pipeline (never fixture-side
 * bridging). Implementations run the real Stage 3 adapters
 * (`DocumentTransformerPort` + `EvidenceLocatorPort` +
 * `TransformationRepositoryPort` + `EvidenceRepositoryPort` +
 * `AssetStoragePort`); the pipeline is idempotent (transformation save reuses
 * the stored revision for the same SourceVersion/transformer output and the
 * evidence index upserts).
 */
export type SourcesStage3PipelinePort = {
  runForSourceVersion(input: {
    readonly projectId: string;
    readonly sourceId: string;
    readonly sourceVersionId: string;
    readonly storageKey: string;
    readonly mediaType: 'text/plain' | 'text/markdown';
    readonly contentHash: string;
    readonly accessScope: readonly string[];
    readonly sensitivity: SourcesSensitivity;
  }): Promise<void>;
};
