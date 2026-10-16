import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { PythonDocumentFormatAdapter } from '../../../adapters/document-format-python/src/index.js';
import { PostgresImageObservationExecutionRepository } from '../../../adapters/image-observation-execution-postgres/src/index.js';
import type { AssetStoragePort } from '../../../modules/original-asset/src/index.js';
import type { TransformationRepositoryPort } from '../../../modules/transformation/src/index.js';
import type { VPImageObservationLedgerPort } from '../../../modules/vp-knowledge-ledger/src/image-observations.js';
import type { SourcesStage3PipelinePort } from '../../../modules/frontend-sources-write/src/stage3-pipeline.js';
import {
  executeImageObservation,
  imageObservationTransformationIdentity,
  type ImageObservationExecutionResolverPort,
  type IsolatedImageLiveAcceptance,
} from '../../../modules/image-observation-execution/src/index.js';
import { ShotgunError, stableJson } from '../../../packages/contracts/src/index.js';
import { VP_IMAGE_OBSERVATION_SCHEMA_V1 } from '../../../packages/contracts/src/vp-image-observation.js';

type Stage3Input = Parameters<SourcesStage3PipelinePort['runForSourceVersion']>[0];
export type ImageObservationRuntimeOptions = {
  readonly runtimeProfile: string;
  readonly pool: Pool;
  readonly storage: AssetStoragePort;
  /** Existing app owner/membership + sensitivity + standing/config authority.
   * Required for every invocation, including stored-output replay. No provider
   * or credential resolution belongs in this preflight authorization callback. */
  readonly authorizeSourceInput: (input: Stage3Input) => Promise<void>;
  readonly imageExecutionResolver: ImageObservationExecutionResolverPort;
  readonly liveAcceptance?: IsolatedImageLiveAcceptance;
  readonly transformationRepository: TransformationRepositoryPort;
  readonly ledger: VPImageObservationLedgerPort;
  readonly pythonExecutable?: string;
  readonly workerPath?: string;
};
const denied: (message: string) => never = (message) => {
  throw new ShotgunError({
    code: 'POLICY_DENIED',
    safeMessage: message,
    module: 'image-observation-runtime',
    operation: 'process-image-source',
    retryable: false,
  });
};

/** Additive isolated image assembly. Normal capability remains OFF. Live
 * acceptance requires the separately injected bounded grant; it cannot use
 * the Fake transport identity or activate a production runtime. */
export function createImageObservationRuntime(options: ImageObservationRuntimeOptions): {
  runForSourceVersion(
    input: Stage3Input,
  ): Promise<{ observationId: string; revisionId: string; reused: boolean }>;
} {
  if (
    options.runtimeProfile !== 'runtime-test' ||
    typeof options.authorizeSourceInput !== 'function' ||
    typeof options.imageExecutionResolver?.resolve !== 'function'
  )
    denied('Isolated image execution authority is unavailable.');
  const { pool, storage, transformationRepository } = options;
  const ledger: VPImageObservationLedgerPort = options.ledger;
  const authorize = options.authorizeSourceInput;
  const resolver = options.imageExecutionResolver,
    resolve = resolver.resolve;
  const liveAcceptance = options.liveAcceptance;
  const capturedResolver: ImageObservationExecutionResolverPort = {
    resolve: (snapshot) => resolve.call(resolver, snapshot),
  };
  const pythonOptions = {
    pythonExecutable: options.pythonExecutable,
    workerPath: options.workerPath,
  };
  const preflight = new PythonDocumentFormatAdapter(pythonOptions);
  const executionRepository = new PostgresImageObservationExecutionRepository(pool);
  return {
    runForSourceVersion: async (supplied) => {
      const input: Stage3Input = Object.freeze({
        ...supplied,
        accessScope: Object.freeze([...supplied.accessScope]),
      });
      if (input.mediaType !== 'image/png' && input.mediaType !== 'image/jpeg')
        denied('Image execution requires PNG or JPEG.');
      await authorize(input);
      const visible = await pool.query<{
        original_asset_id: string;
        storage_key: string;
        content_hash: string;
        media_type: 'image/png' | 'image/jpeg';
        access_scope: string[];
        sensitivity: Stage3Input['sensitivity'];
      }>(
        `SELECT version.original_asset_id::text,original.storage_key,original.content_hash,version.media_type,version.access_scope,version.sensitivity
        FROM asset.source_versions version JOIN asset.sources source ON source.source_id=version.source_id
        JOIN asset.original_assets original ON original.asset_id=version.original_asset_id
        JOIN project_admin.projects project ON project.id=source.project_id
        LEFT JOIN project_admin.project_knowledge_epoch epoch ON epoch.project_id=source.project_id
        WHERE version.source_version_id=$1 AND source.source_id=$2 AND source.project_id=$3 AND project.active AND project.status='ACTIVE'
          AND (epoch.state IS NULL OR epoch.state='READY')
          AND NOT EXISTS (SELECT 1 FROM asset.source_versions newer WHERE newer.source_id=source.source_id AND newer.version_number>version.version_number)`,
        [input.sourceVersionId, input.sourceId, input.projectId],
      );
      const pin = visible.rows[0];
      if (
        !pin ||
        pin.storage_key !== input.storageKey ||
        pin.content_hash !== input.contentHash ||
        pin.media_type !== input.mediaType ||
        pin.sensitivity !== input.sensitivity ||
        stableJson(pin.access_scope) !== stableJson(input.accessScope)
      )
        denied('Image source authority is unavailable or changed.');
      const bytes = Uint8Array.from(await storage.read(pin.storage_key));
      if (`sha256:${createHash('sha256').update(bytes).digest('hex')}` !== pin.content_hash)
        denied('Original image bytes do not match the authorized SourceVersion.');
      const contentBase64 = Buffer.from(bytes).toString('base64');
      const decoded = await preflight.preflightImage({
        mediaType: pin.media_type,
        contentBase64,
        sourceContentHash: pin.content_hash,
      });
      const record = await executeImageObservation(
        {
          projectId: input.projectId,
          requestId: `image-observation:${input.sourceVersionId}:${preflight.identity.id}:${preflight.identity.version}`,
          sourceId: input.sourceId,
          sourceVersionId: input.sourceVersionId,
          originalAssetId: pin.original_asset_id,
          sourceContentHash: pin.content_hash,
          transformerId: preflight.identity.id,
          transformerVersion: preflight.identity.version,
          image: {
            mediaType: pin.media_type,
            width: decoded.width,
            height: decoded.height,
            region: { x: 0, y: 0, width: decoded.width, height: decoded.height, unit: 'px' },
          },
          accessScope: input.accessScope,
          sensitivity: input.sensitivity,
          imageBytes: bytes,
        },
        {
          runtimeProfile: 'runtime-test',
          repository: executionRepository,
          resolver: capturedResolver,
          ...(liveAcceptance ? { liveAcceptance } : {}),
        },
      );
      if (record.state === 'OUTCOME_UNKNOWN' || record.state === 'PROVIDER_RUNNING')
        throw new ShotgunError({
          code: 'OUTCOME_UNKNOWN',
          safeMessage:
            'The existing image execution outcome requires reconciliation; another provider call is prohibited.',
          module: 'image-observation-runtime',
          operation: 'read-image-outcome',
          retryable: false,
        });
      if (!record.output || !['OUTPUT_STORED', 'COMPLETED'].includes(record.state))
        throw new ShotgunError({
          code: 'TERMINAL_FAILURE',
          safeMessage: 'The image observation was not durably accepted.',
          module: 'image-observation-runtime',
          operation: 'read-image-output',
          retryable: false,
        });
      let completed = record;
      if (record.state === 'OUTPUT_STORED') {
        const transformerIdentity = imageObservationTransformationIdentity(record);
        const transformer = new PythonDocumentFormatAdapter({
          ...pythonOptions,
          multimodal: { describe: async () => record.output!.text },
        });
        const output = await transformer.transform({
          sourceId: input.sourceId,
          sourceVersionId: input.sourceVersionId,
          sourceContentHash: pin.content_hash,
          mediaType: pin.media_type,
          contentBase64,
        });
        const saved = await transformationRepository.save({
          projectId: input.projectId,
          sourceId: input.sourceId,
          sourceVersionId: input.sourceVersionId,
          sourceContentHash: pin.content_hash,
          transformer: transformerIdentity,
          output,
          accessScope: input.accessScope,
          sensitivity: input.sensitivity,
          createdAt: record.createdAt,
        });
        completed = await executionRepository.finalize({
          projectId: input.projectId,
          callId: record.callId,
          attemptId: record.attemptId!,
          transformationRevisionId: saved.revision.revisionId,
        });
      }
      const proof = await executionRepository.findCompleted({
        projectId: input.projectId,
        callId: completed.callId,
        attemptId: completed.attemptId!,
      });
      if (!proof) denied('Completed image derivation is unavailable.');
      const published = await ledger.append({
        ...proof,
        schemaVersion: VP_IMAGE_OBSERVATION_SCHEMA_V1,
        observationId: completed.callId,
        epistemicStatus: 'GENERATED_UNVERIFIED',
        createdAt: completed.createdAt,
      });
      return {
        observationId: published.observation.observationId,
        revisionId: proof.derivation.transformationRevisionId,
        reused: published.reused,
      };
    },
  };
}
