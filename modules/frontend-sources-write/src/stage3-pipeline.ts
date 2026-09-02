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

/** Stage 4 is started only after the Stage 3 Evidence transaction has
 * committed. The callback is intentionally a narrow event boundary so the
 * Sources domain never owns Candidate or AI persistence. */
export type SourcesStage3EvidenceIndexedInput = {
  readonly projectId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly revisionId: string;
  readonly evidenceCount: number;
  readonly reusedCount: number;
  readonly accessScope: readonly string[];
  readonly sensitivity: SourcesSensitivity;
  readonly dataClassification: string;
};

export type SourcesStage4ContinuationPort = {
  onEvidenceIndexed(input: SourcesStage3EvidenceIndexedInput): Promise<void>;
};
