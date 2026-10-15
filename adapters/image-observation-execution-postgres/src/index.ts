import type { Pool } from 'pg';
import { ShotgunError, stableJson } from '../../../packages/contracts/src/index.js';
import type { VPImageObservationDerivationProofV1 } from '../../../packages/contracts/src/vp-image-observation.js';
import type {
  ImageObservationExecutionRecord,
  ImageObservationExecutionRepositoryPort,
  ImageObservationExecutionState,
  ImageObservationStoredOutput,
  ImageObservationRejectedResponseAudit,
} from '../../../modules/image-observation-execution/src/index.js';
import { imageObservationTransformationIdentity } from '../../../modules/image-observation-execution/src/index.js';

type Row = {
  execution_mode: 'ISOLATED_FAKE' | 'ISOLATED_LIVE_ACCEPTANCE';
  record_json: ImageObservationExecutionRecord;
  state: ImageObservationExecutionState;
  attempt_id: string | null;
  output_json: ImageObservationStoredOutput | null;
  rejected_response_json: ImageObservationRejectedResponseAudit | null;
  transformation_revision_id: string | null;
};
const fromRow = (row: Row): ImageObservationExecutionRecord => {
  if (row.execution_mode !== (row.record_json.transportKind ?? 'ISOLATED_FAKE'))
    invalid('Image SQL and JSON transport identities disagree');
  return {
    ...row.record_json,
    transportKind: row.record_json.transportKind ?? 'ISOLATED_FAKE',
    state: row.state,
    ...(row.attempt_id === null ? {} : { attemptId: row.attempt_id }),
    ...(row.output_json === null ? {} : { output: row.output_json }),
    ...(row.rejected_response_json == null ? {} : { rejectedResponse: row.rejected_response_json }),
    ...(row.transformation_revision_id === null
      ? {}
      : { transformationRevisionId: row.transformation_revision_id }),
  };
};
const invalid: (message: string) => never = (message) => {
  throw new ShotgunError({
    code: 'VALIDATION_ERROR',
    safeMessage: message,
    module: 'image-observation-execution-postgres',
    operation: 'persist-image-execution',
    retryable: false,
  });
};

/** Existing AI owner; one SQL CAS activates one attempt. There is no lease
 * expiry retry, automatic paid replay, new global authority or credential read. */
export class PostgresImageObservationExecutionRepository implements ImageObservationExecutionRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async read(
    projectId: string,
    requestId: string,
  ): Promise<ImageObservationExecutionRecord | undefined> {
    const result = await this.pool.query<Row>(
      'SELECT * FROM ai.image_observation_executions WHERE project_id=$1 AND request_id=$2',
      [projectId, requestId],
    );
    return result.rows[0] ? fromRow(result.rows[0]) : undefined;
  }

  async ensure(record: ImageObservationExecutionRecord): Promise<ImageObservationExecutionRecord> {
    if (
      record.state !== 'REQUESTED' ||
      record.attemptId ||
      record.output ||
      record.transformationRevisionId
    )
      invalid('Only an unstarted image request may be created');
    if (
      !['ISOLATED_FAKE', 'ISOLATED_LIVE_ACCEPTANCE'].includes(record.transportKind ?? '') ||
      (record.transportKind === 'ISOLATED_LIVE_ACCEPTANCE') !==
        (typeof record.acceptanceId === 'string' && record.acceptanceId.length > 0)
    )
      invalid('Image transport acceptance identity is invalid');
    const snapshot = record.snapshot;
    await this.pool.query(
      `INSERT INTO ai.image_observation_executions
      (call_id,project_id,request_id,source_version_id,state,request_digest,record_json,created_at,execution_mode)
      SELECT $1,$2,$3,$4,'REQUESTED',$5,$6::jsonb,$7::timestamptz,$14
      WHERE EXISTS (SELECT 1 FROM asset.source_versions version
        JOIN asset.sources source ON source.source_id=version.source_id
        JOIN asset.original_assets original ON original.asset_id=version.original_asset_id
        WHERE version.source_version_id=$4 AND source.project_id=$2 AND source.source_id=$8
          AND original.asset_id=$9 AND original.content_hash=$10 AND version.media_type=$11
          AND version.access_scope=$12::text[] AND version.sensitivity=$13
          AND NOT EXISTS (SELECT 1 FROM asset.source_versions newer WHERE newer.source_id=source.source_id AND newer.version_number>version.version_number))
      ON CONFLICT (project_id,request_id) DO NOTHING`,
      [
        record.callId,
        snapshot.projectId,
        snapshot.requestId,
        snapshot.sourceVersionId,
        record.requestDigest,
        JSON.stringify(record),
        record.createdAt,
        snapshot.sourceId,
        snapshot.originalAssetId,
        snapshot.sourceContentHash,
        snapshot.image.mediaType,
        snapshot.accessScope,
        snapshot.sensitivity,
        record.transportKind,
      ],
    );
    const existing = await this.read(snapshot.projectId, snapshot.requestId);
    if (
      !existing ||
      existing.requestDigest !== record.requestDigest ||
      stableJson(existing.executionIdentity) !== stableJson(record.executionIdentity) ||
      existing.credentialFingerprint !== record.credentialFingerprint ||
      existing.adapterVersion !== record.adapterVersion ||
      existing.transportKind !== record.transportKind ||
      (existing.acceptanceId ?? undefined) !== (record.acceptanceId ?? undefined)
    )
      invalid('Image source or durable execution authority does not match');
    return existing;
  }

  async activate(projectId: string, callId: string, attemptId: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE ai.image_observation_executions execution
      SET state='PROVIDER_RUNNING',attempt_id=$3,activated_at=clock_timestamp()
      WHERE project_id=$1 AND call_id=$2 AND state='REQUESTED'
        AND EXISTS (SELECT 1 FROM asset.source_versions version WHERE version.source_version_id=execution.source_version_id
          AND NOT EXISTS (SELECT 1 FROM asset.source_versions newer WHERE newer.source_id=version.source_id AND newer.version_number>version.version_number))
      RETURNING call_id`,
      [projectId, callId, attemptId],
    );
    return result.rowCount === 1;
  }

  async storeOutput(
    projectId: string,
    callId: string,
    attemptId: string,
    output: ImageObservationStoredOutput,
  ): Promise<void> {
    const result = await this.pool.query(
      `UPDATE ai.image_observation_executions SET state='OUTPUT_STORED',output_json=$4::jsonb,output_stored_at=clock_timestamp()
      WHERE project_id=$1 AND call_id=$2 AND attempt_id=$3 AND state IN ('PROVIDER_RUNNING','OUTCOME_UNKNOWN') AND output_json IS NULL RETURNING call_id`,
      [projectId, callId, attemptId, JSON.stringify(output)],
    );
    if (result.rowCount !== 1) {
      const readback = await this.pool.query<Row>(
        'SELECT * FROM ai.image_observation_executions WHERE project_id=$1 AND call_id=$2 AND attempt_id=$3',
        [projectId, callId, attemptId],
      );
      if (
        !readback.rows[0] ||
        !['OUTPUT_STORED', 'COMPLETED'].includes(readback.rows[0].state) ||
        stableJson(readback.rows[0].output_json) !== stableJson(output)
      )
        invalid('Image output cannot replace an existing attempt outcome');
    }
  }

  async markUnknown(projectId: string, callId: string, attemptId: string): Promise<void> {
    await this.pool.query(
      `UPDATE ai.image_observation_executions SET state='OUTCOME_UNKNOWN' WHERE project_id=$1 AND call_id=$2 AND attempt_id=$3 AND state='PROVIDER_RUNNING'`,
      [projectId, callId, attemptId],
    );
  }

  async rejectOutput(
    projectId: string,
    callId: string,
    attemptId: string,
    audit?: ImageObservationRejectedResponseAudit,
  ): Promise<void> {
    const result = await this.pool.query(
      `UPDATE ai.image_observation_executions SET state='OUTPUT_REJECTED',rejected_response_json=$4::jsonb WHERE project_id=$1 AND call_id=$2 AND attempt_id=$3 AND state IN ('PROVIDER_RUNNING','OUTCOME_UNKNOWN')`,
      [projectId, callId, attemptId, audit === undefined ? null : JSON.stringify(audit)],
    );
    if (result.rowCount !== 1) {
      const readback = await this.pool.query<Row>(
        'SELECT * FROM ai.image_observation_executions WHERE project_id=$1 AND call_id=$2 AND attempt_id=$3',
        [projectId, callId, attemptId],
      );
      if (
        !readback.rows[0] ||
        readback.rows[0].state !== 'OUTPUT_REJECTED' ||
        stableJson(readback.rows[0].rejected_response_json ?? null) !== stableJson(audit ?? null)
      )
        invalid('Image rejection cannot replace an existing attempt outcome');
    }
  }

  async finalize(input: {
    projectId: string;
    callId: string;
    attemptId: string;
    transformationRevisionId: string;
  }): Promise<ImageObservationExecutionRecord> {
    const existing = await this.pool.query<Row>(
      'SELECT * FROM ai.image_observation_executions WHERE project_id=$1 AND call_id=$2 AND attempt_id=$3',
      [input.projectId, input.callId, input.attemptId],
    );
    if (!existing.rows[0]) invalid('Image execution is unavailable for finalization');
    const transformer = imageObservationTransformationIdentity(fromRow(existing.rows[0]));
    await this.pool.query(
      `UPDATE ai.image_observation_executions execution SET state='COMPLETED',transformation_revision_id=$4,completed_at=clock_timestamp()
      WHERE project_id=$1 AND call_id=$2 AND attempt_id=$3 AND state='OUTPUT_STORED'
      AND EXISTS (SELECT 1 FROM transformation.revisions revision
        WHERE revision.revision_id=$4 AND revision.project_id=$1 AND revision.source_version_id=execution.source_version_id
          AND revision.source_id::text=execution.record_json->'snapshot'->>'sourceId'
          AND revision.source_content_hash=execution.record_json->'snapshot'->>'sourceContentHash'
          AND revision.transformer_id=$5
          AND revision.transformer_version=$6
          AND revision.document_ir->>'mediaType'=execution.record_json->'snapshot'->'image'->>'mediaType'
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(revision.source_map->'entries') entry
            WHERE entry->>'nodeKind'='document' AND entry->>'origin'='annotation' AND entry->'quote'->>'exact'=execution.output_json->>'text')
          AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(revision.source_map->'entries') entry WHERE entry->>'origin' IS DISTINCT FROM 'annotation'))`,
      [
        input.projectId,
        input.callId,
        input.attemptId,
        input.transformationRevisionId,
        transformer.id,
        transformer.version,
      ],
    );
    const result = await this.pool.query<Row>(
      'SELECT * FROM ai.image_observation_executions WHERE project_id=$1 AND call_id=$2 AND attempt_id=$3',
      [input.projectId, input.callId, input.attemptId],
    );
    const row = result.rows[0];
    if (
      !row ||
      row.state !== 'COMPLETED' ||
      row.transformation_revision_id !== input.transformationRevisionId
    )
      invalid('Image finalization requires its exact generated annotation revision');
    return fromRow(row);
  }

  async findCompleted(input: {
    projectId: string;
    callId: string;
    attemptId: string;
  }): Promise<VPImageObservationDerivationProofV1 | undefined> {
    const result = await this.pool.query<Row>(
      `SELECT * FROM ai.image_observation_executions WHERE project_id=$1 AND call_id=$2 AND attempt_id=$3 AND state='COMPLETED'`,
      [input.projectId, input.callId, input.attemptId],
    );
    if (!result.rows[0]) return undefined;
    const record = fromRow(result.rows[0]),
      output = record.output!;
    const {
      requestId: _requestId,
      transformerId: _transformerId,
      transformerVersion: _transformerVersion,
      ...source
    } = record.snapshot;
    const transformer = imageObservationTransformationIdentity(record);
    return {
      ...source,
      text: output.text,
      derivation: {
        transformationRevisionId: record.transformationRevisionId!,
        transformerId: transformer.id,
        transformerVersion: transformer.version,
        callId: record.callId,
        attemptId: record.attemptId!,
        requestDigest: record.requestDigest,
        inputSnapshotDigest: record.inputSnapshotDigest,
        responseDigest: output.responseDigest,
        providerId: record.executionIdentity.providerId,
        modelId: record.executionIdentity.modelId,
        adapterVersion: record.adapterVersion,
        credentialFingerprint: record.credentialFingerprint,
        executionIdentity: record.executionIdentity,
        transportRequestDigest: output.transportRequestDigest,
        ...(output.providerResponseId === undefined
          ? {}
          : { providerResponseId: output.providerResponseId }),
      },
    };
  }
}
