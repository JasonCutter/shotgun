import type { Pool, QueryResultRow } from 'pg';
import {
  ShotgunError,
  sha256Text,
  stableJson,
  type DocumentIR,
  type SourceMap,
} from '../../../packages/contracts/src/index.js';
import {
  buildEvidenceCandidates,
  type EvidenceLocatorPort,
} from '../../../modules/evidence/src/index.js';
import { LucasAugmentedPlainTextAdapter } from '../../plain-text-lucas-augmented/src/index.js';
import {
  imageObservationDerivationProof,
  parseVPImageObservationV1,
  type VPImageObservationV1,
} from '../../../packages/contracts/src/vp-image-observation.js';
import type {
  VPImageObservationDerivationReaderPort,
  VPImageObservationLedgerPort,
  VPImageObservationReadScope,
} from '../../../modules/vp-knowledge-ledger/src/image-observations.js';
import type { VPAssertionReadScope } from '../../../modules/vp-knowledge-ledger/src/index.js';
import { withSafePostgresTransaction } from '../../../packages/postgres-transaction/src/index.js';

const reject: (code: 'POLICY_DENIED' | 'REVISION_CONFLICT', message: string) => never = (
  code,
  message,
) => {
  throw new ShotgunError({
    code,
    safeMessage: message,
    module: 'vp-image-observation-ledger',
    operation: 'append',
    retryable: false,
  });
};
type BindingRow = QueryResultRow & {
  readonly content_hash: string;
  readonly media_type: string;
  readonly access_scope: string[];
  readonly sensitivity: string;
  readonly source_content_hash: string;
  readonly transformer_id: string;
  readonly transformer_version: string;
  readonly revision_access_scope: string[];
  readonly revision_sensitivity: string;
  readonly source_map: SourceMap;
  readonly document_ir: DocumentIR;
  readonly document_hash: string;
  readonly source_map_hash: string;
};
const ordered = (scope: readonly string[]) => [...scope].sort();
const scopeValid = (scope: VPAssertionReadScope): boolean =>
  Boolean(
    scope.projectId.trim() &&
    scope.accessScope.length > 0 &&
    scope.authorizedSensitivities.length > 0,
  );

/** Persistence is under VP ownership; completed-call provenance is read through
 * the AI owner's Port. No provider, secret, budget or relation execution exists here. */
export class PostgresVPImageObservationLedger implements VPImageObservationLedgerPort {
  constructor(
    private readonly pool: Pool,
    private readonly derivations: VPImageObservationDerivationReaderPort,
    private readonly locator: EvidenceLocatorPort = new LucasAugmentedPlainTextAdapter(),
  ) {}

  async append(
    value: VPImageObservationV1,
  ): Promise<{ observation: VPImageObservationV1; reused: boolean }> {
    const observation = parseVPImageObservationV1(value);
    const proof = await this.derivations.findCompleted({
      projectId: observation.projectId,
      callId: observation.derivation.callId,
      attemptId: observation.derivation.attemptId,
    });
    if (!proof || stableJson(proof) !== stableJson(imageObservationDerivationProof(observation))) {
      reject('REVISION_CONFLICT', 'The completed image derivation does not match the publication.');
    }
    return withSafePostgresTransaction(
      this.pool,
      async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          `vp-ledger:${observation.projectId}`,
        ]);
        const binding = await client.query<BindingRow>(
          `SELECT original.content_hash,version.media_type,version.access_scope,version.sensitivity,
                revision.source_content_hash,revision.transformer_id,revision.transformer_version,
                revision.source_map,revision.document_ir,revision.document_hash,revision.source_map_hash,
                revision.access_scope AS revision_access_scope,revision.sensitivity AS revision_sensitivity
           FROM asset.sources AS source
           JOIN project_admin.projects AS project ON project.id=source.project_id AND project.active AND project.status='ACTIVE'
           JOIN asset.source_versions AS version ON version.source_id=source.source_id
           JOIN asset.original_assets AS original ON original.asset_id=version.original_asset_id
           JOIN transformation.revisions AS revision ON revision.project_id=source.project_id
            AND revision.source_id=source.source_id AND revision.source_version_id=version.source_version_id
           LEFT JOIN project_admin.project_knowledge_epoch AS reset ON reset.project_id=source.project_id
          WHERE source.project_id=$1 AND source.source_id=$2 AND version.source_version_id=$3
            AND original.asset_id=$4 AND revision.revision_id=$5 AND (reset.state IS NULL OR reset.state='READY')
          FOR SHARE OF source,version,original,revision`,
          [
            observation.projectId,
            observation.sourceId,
            observation.sourceVersionId,
            observation.originalAssetId,
            observation.derivation.transformationRevisionId,
          ],
        );
        const row = binding.rows[0];
        if (
          !row ||
          row.content_hash !== observation.sourceContentHash ||
          row.source_content_hash !== observation.sourceContentHash ||
          row.media_type !== observation.image.mediaType ||
          row.sensitivity !== observation.sensitivity ||
          row.revision_sensitivity !== observation.sensitivity ||
          stableJson(ordered(row.access_scope)) !== stableJson(ordered(observation.accessScope)) ||
          stableJson(ordered(row.revision_access_scope)) !==
            stableJson(ordered(observation.accessScope)) ||
          row.document_ir?.mediaType !== observation.image.mediaType ||
          row.transformer_id !== observation.derivation.transformerId ||
          row.transformer_version !== observation.derivation.transformerVersion ||
          sha256Text(stableJson(row.source_map)) !== row.source_map_hash ||
          sha256Text(stableJson(row.document_ir)) !== row.document_hash
        ) {
          reject('POLICY_DENIED', 'The original image and transformation authority do not match.');
        }
        const entries = row.source_map?.entries;
        const root = entries?.find((entry) => entry.pointer === '');
        const region = { type: 'BoundingBoxSelector', ...observation.image.region };
        const fullImageRegion = {
          type: 'BoundingBoxSelector',
          x: 0,
          y: 0,
          width: observation.image.width,
          height: observation.image.height,
          unit: 'px',
        };
        if (
          !Array.isArray(entries) ||
          !entries.length ||
          root?.quote.exact !== observation.text ||
          entries.some(
            (entry) =>
              entry.origin !== 'annotation' ||
              entry.sourceVersionId !== observation.sourceVersionId ||
              entry.sourceContentHash !== observation.sourceContentHash,
          ) ||
          !entries.some((entry) =>
            entry.selectors?.some(
              (selector: unknown) => stableJson(selector) === stableJson(region),
            ),
          ) ||
          !entries.some((entry) =>
            entry.selectors?.some(
              (selector: unknown) => stableJson(selector) === stableJson(fullImageRegion),
            ),
          )
        ) {
          reject(
            'REVISION_CONFLICT',
            'Only the exact generated image annotation and region may be recorded.',
          );
        }
        // Reuse the existing source-map integrity validator to verify all
        // generated positions/quotes against DocumentIR. Annotation origin
        // must still produce zero literal original Evidence.
        if (
          buildEvidenceCandidates(
            {
              revisionId: observation.derivation.transformationRevisionId,
              projectId: observation.projectId,
              sourceId: observation.sourceId,
              sourceVersionId: observation.sourceVersionId,
              sourceContentHash: observation.sourceContentHash,
              transformer: { id: row.transformer_id, version: row.transformer_version },
              documentIR: row.document_ir,
              sourceMap: row.source_map,
              documentHash: row.document_hash,
              sourceMapHash: row.source_map_hash,
              accessScope: observation.accessScope,
              sensitivity: observation.sensitivity,
              createdAt: observation.createdAt,
            },
            this.locator,
          ).length !== 0
        )
          reject('REVISION_CONFLICT', 'Generated observation must not contain original Evidence.');
        const inserted = await client.query<{ payload: unknown }>(
          `INSERT INTO vp.image_observations(observation_id,project_id,source_id,source_version_id,original_asset_id,
           transformation_revision_id,call_id,attempt_id,source_content_hash,observation_text,epistemic_status,
           access_scope,sensitivity,payload,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'GENERATED_UNVERIFIED',$11,$12,$13::jsonb,$14)
         ON CONFLICT DO NOTHING RETURNING payload`,
          [
            observation.observationId,
            observation.projectId,
            observation.sourceId,
            observation.sourceVersionId,
            observation.originalAssetId,
            observation.derivation.transformationRevisionId,
            observation.derivation.callId,
            observation.derivation.attemptId,
            observation.sourceContentHash,
            observation.text,
            observation.accessScope,
            observation.sensitivity,
            JSON.stringify(observation),
            observation.createdAt,
          ],
        );
        if (inserted.rows[0]) {
          await client.query(
            `INSERT INTO vp.project_epochs(project_id) VALUES($1) ON CONFLICT DO NOTHING`,
            [observation.projectId],
          );
          await client.query(
            `UPDATE vp.project_epochs SET current_epoch=current_epoch+1,updated_at=clock_timestamp() WHERE project_id=$1`,
            [observation.projectId],
          );
          return {
            observation: parseVPImageObservationV1(inserted.rows[0].payload),
            reused: false,
          };
        }
        const existing = await client.query<{ payload: unknown }>(
          `SELECT payload FROM vp.image_observations WHERE project_id=$1 AND call_id=$2`,
          [observation.projectId, observation.derivation.callId],
        );
        if (!existing.rows[0] || stableJson(existing.rows[0].payload) !== stableJson(observation)) {
          reject(
            'REVISION_CONFLICT',
            'The image call or observation identity has already been bound to another publication.',
          );
        }
        return { observation: parseVPImageObservationV1(existing.rows[0].payload), reused: true };
      },
      { module: 'vp-image-observation-ledger', operation: 'append' },
    );
  }

  async listCurrent(scope: VPImageObservationReadScope): Promise<readonly VPImageObservationV1[]> {
    if (!scopeValid(scope)) return [];
    const limit = Math.max(1, Math.min(64, Math.floor(scope.limit ?? 32)));
    const result = await (scope.queryExecutor ?? this.pool).query<{ payload: unknown }>(
      `WITH raw_query_terms AS (
        SELECT regexp_split_to_table(trim(regexp_replace(lower(COALESCE($6::text,'')), '[^[:alnum:]가-힣]+', ' ', 'g')), '\\s+') AS term
      ), query_terms AS (
        SELECT term FROM raw_query_terms WHERE char_length(term)>=2
        UNION SELECT regexp_replace(term,'(으로는|에서는|에게는|으로|에서|에게|보다|부터|까지|은|는|이|가|을|를|에|와|과|도|로|의|만)$','')
        FROM raw_query_terms WHERE char_length(term)>=3
      ) ${readableSql}
      AND version.version_number=(SELECT max(latest.version_number) FROM asset.source_versions AS latest WHERE latest.source_id=source.source_id)
      AND ($4::uuid[] IS NULL OR observation.source_version_id=ANY($4::uuid[]))
      AND ($6::text IS NULL OR (
        to_tsvector('simple',observation.payload->>'text') @@ websearch_to_tsquery('simple',$6)
        OR (observation.payload->>'text') % $6
        OR observation.payload->>'text' ILIKE '%' || $6 || '%'
        OR EXISTS (SELECT 1 FROM query_terms WHERE char_length(term)>=2 AND lower(observation.payload->>'text') ILIKE '%' || term || '%')
      ))
      ORDER BY CASE WHEN $6::text IS NULL THEN 0 ELSE GREATEST(
        ts_rank_cd(to_tsvector('simple',observation.payload->>'text'),websearch_to_tsquery('simple',$6)),
        similarity(observation.payload->>'text',$6),
        (SELECT count(*)::double precision FROM query_terms WHERE char_length(term)>=2 AND lower(observation.payload->>'text') ILIKE '%' || term || '%')
      ) END DESC,observation.created_at,observation.observation_id LIMIT $5`,
      [
        scope.projectId,
        scope.accessScope,
        scope.authorizedSensitivities,
        scope.sourceVersionIds ?? null,
        limit,
        scope.question ?? null,
      ],
    );
    return result.rows.map((row) => parseVPImageObservationV1(row.payload));
  }

  async findHistorical(
    scope: VPImageObservationReadScope,
    observationId: string,
  ): Promise<VPImageObservationV1 | undefined> {
    if (!scopeValid(scope)) return undefined;
    const result = await (scope.queryExecutor ?? this.pool).query<{ payload: unknown }>(
      `${readableSql} AND observation.observation_id=$4`,
      [scope.projectId, scope.accessScope, scope.authorizedSensitivities, observationId],
    );
    return result.rows[0] ? parseVPImageObservationV1(result.rows[0].payload) : undefined;
  }
}

const readableSql = `SELECT observation.payload FROM vp.image_observations AS observation
  JOIN asset.sources AS source ON source.source_id=observation.source_id AND source.project_id=observation.project_id
  JOIN project_admin.projects AS project ON project.id=source.project_id AND project.active AND project.status='ACTIVE'
  JOIN asset.source_versions AS version ON version.source_version_id=observation.source_version_id AND version.source_id=source.source_id
  JOIN asset.original_assets AS original ON original.asset_id=version.original_asset_id
   AND original.asset_id=observation.original_asset_id AND original.content_hash=observation.source_content_hash
  JOIN transformation.revisions AS revision ON revision.revision_id=observation.transformation_revision_id
   AND revision.project_id=source.project_id AND revision.source_version_id=version.source_version_id
   AND revision.source_id=source.source_id AND revision.source_content_hash=observation.source_content_hash
  JOIN LATERAL (SELECT access_scope,sensitivity FROM asset.source_versions WHERE source_id=source.source_id ORDER BY version_number DESC LIMIT 1) AS current_version ON true
  LEFT JOIN project_admin.project_knowledge_epoch AS reset ON reset.project_id=source.project_id
  WHERE observation.project_id=$1 AND observation.access_scope <@ $2::text[] AND version.access_scope <@ $2::text[]
   AND current_version.access_scope <@ $2::text[] AND observation.sensitivity=ANY($3::text[])
   AND version.sensitivity=ANY($3::text[]) AND current_version.sensitivity=ANY($3::text[])
   AND revision.access_scope <@ $2::text[] AND revision.sensitivity=ANY($3::text[])
   AND observation.access_scope @> version.access_scope AND observation.access_scope <@ version.access_scope
   AND observation.access_scope @> revision.access_scope AND observation.access_scope <@ revision.access_scope
   AND observation.sensitivity=revision.sensitivity
   AND observation.sensitivity=version.sensitivity AND version.media_type IN ('image/png','image/jpeg')
   AND (reset.state IS NULL OR reset.state='READY')`;
