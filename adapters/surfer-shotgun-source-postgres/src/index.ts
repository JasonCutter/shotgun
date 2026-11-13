import type { Pool, PoolClient } from 'pg';
import { authorizeSurferAskRead, denySurferAskRead } from './ask-authority.js';
import revisionSchema from '../../../packages/contracts/schemas/get-document-revision-output.v1.schema.json';
import evidenceSchema from '../../../packages/contracts/schemas/evidence-span.v1.schema.json';
import { SchemaRegistry } from '../../../packages/contracts/src/schema-registry.js';
import { sha256Text, stableJson } from '../../../packages/contracts/src/document-evidence.js';
import { ShotgunError } from '../../../packages/contracts/src/errors.js';
import {
  assertSurferJson,
  surferDigest,
  surferFailure,
  type SurferScope,
} from '../../../packages/contracts/src/surfer-learning.js';
import {
  decodeSurferSourceRequest,
  type SurferSourceHead,
  type SurferSourceMaterial,
  type SurferSourceRequest,
  type SurferSourceSnapshot,
  type SurferSourceSession,
  type SurferSourceSessionPort,
} from '../../../packages/contracts/src/surfer-source.js';
import type { SurferAccessContext } from '../../../packages/contracts/src/surfer-experiment.js';
import type { SourcesProjectionRecord } from '../../../modules/frontend-sources-product/src/index.js';
import { buildEvidenceCandidates } from '../../../modules/evidence/src/index.js';
import { withSafePostgresTransaction } from '../../../packages/postgres-transaction/src/index.js';
import { PostgresOriginalAssetRepository } from '../../postgres/src/index.js';
import { PostgresAuthRepository } from '../../postgres-auth/src/index.js';
import {
  PostgresEvidenceRepository,
  PostgresTransformationRepository,
} from '../../postgres-stage3/src/index.js';
import { LucasAugmentedPlainTextAdapter } from '../../plain-text-lucas-augmented/src/index.js';
import { bindSurferKnowledgeStore } from '../../surfer-knowledge-postgres/src/index.js';
import type { SurferKnowledgeState } from '../../../packages/contracts/src/surfer-knowledge.js';
import { bindSurferKnowledgeSession } from '../../surfer-knowledge-postgres/src/session.js';
import { bindSurferBindingSessionV2 } from '../../surfer-binding-postgres/src/session.js';
import type {
  SurferSourceSessionV2,
  SurferSourceSessionPortV2,
  SurferSourceReadMetricsV2,
  SurferBindingStateV2,
} from '../../../packages/contracts/src/surfer-source-binding-v2.js';

import type {
  SurferRowsSourceSession,
  SurferRowsSourceSessionsPort,
  SurferRoutedSourceSessionsPort,
  SurferRoutedSourceSession,
} from '../../../packages/contracts/src/surfer-source-rows.js';
import { bindSurferKnowledgeRowsSession } from '../../surfer-knowledge-rows-postgres/src/index.js';
import { bindSurferRowsBindings } from '../../surfer-binding-postgres/src/rows.js';
const levels = { public: 0, internal: 1, private: 2, restricted: 3 };
const registry = new SchemaRegistry();
registry.register({
  name: 'surfer.bridge-revision',
  version: '1.0.0',
  kind: 'query',
  inputSchema: revisionSchema,
});
registry.register({
  name: 'surfer.bridge-evidence',
  version: '1.0.0',
  kind: 'query',
  inputSchema: evidenceSchema,
});
const locator = new LucasAugmentedPlainTextAdapter();
function deny(): never {
  throw new ShotgunError({
    code: 'POLICY_DENIED',
    safeMessage: 'Source session or current material is not authorized.',
    module: 'surfer.source',
    operation: 'read-source',
  });
}
function allowed(context: SurferAccessContext, scope: SurferScope): boolean {
  return (
    context.spaceId === scope.spaceId &&
    scope.accessScope.every((s) => context.accessScope.includes(s)) &&
    levels[context.clearance] >= levels[scope.sensitivity]
  );
}
/** Existing read repositories receive one MVCC-bound Pool facade; nested transactions are forbidden. */
function readPool(pool: Pool, client: PoolClient, assertActive: () => void): Pool {
  return new Proxy(pool, {
    get(target, property) {
      if (property === 'query')
        return (...args: unknown[]) => {
          assertActive();
          if (typeof args[0] !== 'string' || !/^\s*SELECT\b/i.test(args[0]))
            throw surferFailure('Source repository facade only permits reads.');
          return Reflect.apply(client.query, client, args);
        };
      if (property === 'connect' || property === 'end')
        return () => {
          throw surferFailure('Nested source connection/transaction is forbidden.');
        };
      const member = Reflect.get(target, property, target);
      return typeof member === 'function' ? member.bind(target) : member;
    },
  });
}

type ExtendedSession = { routeProfile?: 'LEGACY' | 'ROWS'; readOnly?: boolean } & Omit<
  SurferSourceSession,
  'store'
> &
  Partial<Pick<SurferSourceSession, 'store'>> &
  Partial<Pick<SurferRowsSourceSession, 'core' | 'bindings'>> &
  Partial<
    Pick<
      SurferSourceSessionV2,
      'bindingStore' | 'readMaterialV2' | 'readContentProofV2' | 'metrics'
    >
  >;
type CacheEntry = {
  projectId: string;
  principalId: string;
  accessDigest: string;
  epoch: string;
  sourceId: string;
  fingerprint: string;
  expiresAt: number;
  bytes: number;
  material: SurferSourceMaterial;
  proof: string;
};
export class PostgresSurferSourceSession
  implements
    SurferSourceSessionPort,
    SurferSourceSessionPortV2,
    SurferRowsSourceSessionsPort,
    SurferRoutedSourceSessionsPort
{
  private readonly cache = new Map<string, CacheEntry>();
  constructor(private readonly pool: Pool) {}
  clearValidationCache(): void {
    this.cache.clear();
  }

  async withSnapshot<T>(
    requestInput: SurferSourceRequest,
    action: (session: SurferSourceSession) => Promise<T>,
  ): Promise<T> {
    return this.openSnapshot(
      requestInput,
      (s) => {
        if (!s.store) throw surferFailure('Legacy Source store unavailable.');
        return action(s as SurferSourceSession);
      },
      false,
    );
  }
  async withSnapshotV2<T>(
    request: SurferSourceRequest,
    action: (session: SurferSourceSessionV2) => Promise<T>,
  ): Promise<T> {
    return this.openSnapshot(
      request,
      (s) => {
        if (!s.store || !s.bindingStore || !s.readMaterialV2 || !s.readContentProofV2 || !s.metrics)
          throw surferFailure('Source binding v2 capability is unavailable.');
        return action(s as SurferSourceSessionV2);
      },
      true,
    );
  }
  async withRowsSnapshot<T>(
    request: SurferSourceRequest,
    mode: 'READ' | 'WRITE',
    action: (session: SurferRowsSourceSession) => Promise<T>,
  ): Promise<T> {
    if (!['READ', 'WRITE'].includes(mode)) throw surferFailure('Unknown Source row mode.');
    return this.openSnapshot(
      request,
      (s) => {
        if (!s.core || !s.bindings || !s.readMaterialV2 || !s.readContentProofV2 || !s.metrics)
          throw surferFailure('Row Source capabilities unavailable.');
        if (mode === 'WRITE' && !s.snapshot.canSynchronize) deny();
        return action({
          snapshot: s.snapshot,
          core: s.core,
          bindings: s.bindings,
          readMaterialV2: s.readMaterialV2,
          readContentProofV2: s.readContentProofV2,
          metrics: s.metrics,
        });
      },
      true,
      mode,
    );
  }
  async withRoutedSnapshot<T>(
    request: SurferSourceRequest,
    intent: 'READ' | 'WRITE',
    apply: (session: SurferRoutedSourceSession) => Promise<T>,
  ): Promise<T> {
    if (!['READ', 'WRITE'].includes(intent)) throw surferFailure('Unknown routed Source intent.');
    return this.openSnapshot(
      request,
      (s) => {
        if (s.routeProfile === 'ROWS') {
          if (!s.core || !s.bindings || !s.metrics || !s.readMaterialV2 || !s.readContentProofV2)
            throw surferFailure('Routed row capabilities unavailable.');
          if (intent === 'WRITE' && !s.snapshot.canSynchronize) deny();
          return apply({
            profile: 'ROWS',
            session: {
              snapshot: s.snapshot,
              core: s.core,
              bindings: s.bindings,
              metrics: s.metrics,
              readMaterialV2: s.readMaterialV2,
              readContentProofV2: s.readContentProofV2,
            },
          });
        }
        if (!s.store || !s.bindingStore || !s.readMaterialV2 || !s.readContentProofV2 || !s.metrics)
          throw surferFailure('Routed legacy capabilities unavailable.');
        return apply({ profile: 'LEGACY', session: s as SurferSourceSessionV2 });
      },
      true,
      undefined,
      intent,
    );
  }
  /** Snapshot metadata only: no aggregate/store capability escapes into this read-only callback. */
  async withMetadataSnapshot<T>(
    request: SurferSourceRequest,
    apply: (snapshot: SurferSourceSnapshot) => Promise<T>,
  ): Promise<T> {
    return this.openSnapshot(
      request,
      (s) => apply(structuredClone(s.snapshot)),
      true,
      undefined,
      'READ',
      true,
    );
  }
  private async openSnapshot<T>(
    requestInput: SurferSourceRequest,
    action: (session: ExtendedSession) => Promise<T>,
    version2: boolean,
    rowMode?: 'READ' | 'WRITE',
    routedIntent?: 'READ' | 'WRITE',
    metadataOnly = false,
  ): Promise<T> {
    const request = decodeSurferSourceRequest(requestInput);
    const askRequest = 'ask' in request ? request : undefined;
    if (askRequest && !metadataOnly && routedIntent !== 'READ' && rowMode !== 'READ')
      denySurferAskRead();
    let askStamp: string | undefined;
    const result = await withSafePostgresTransaction(
      this.pool,
      async (client) => {
        let routeBlocked = false;
        if (routedIntent) {
          const route = (
            await client.query<{ mode: string }>(
              'SELECT mode FROM surfer_rows.route WHERE space_id=$1',
              [request.projectId],
            )
          ).rows[0];
          if (route?.mode === 'ROWS' || route?.mode === 'SUSPENDED') rowMode = routedIntent;
          routeBlocked =
            !!route &&
            (['COPYING', 'CONFLICT'].includes(route.mode) ||
              (route.mode === 'SUSPENDED' && routedIntent === 'WRITE'));
          if (rowMode === 'READ' || metadataOnly || askRequest)
            await client.query('SET TRANSACTION READ ONLY');
        }
        let active = true;
        const assertActive = () => {
          if (!active) throw surferFailure('Source session has expired.');
        };
        try {
          const bound = readPool(this.pool, client, assertActive);
          const auth = new PostgresAuthRepository(bound);
          const askAuthority = askRequest
            ? await authorizeSurferAskRead(client, askRequest)
            : undefined;
          askStamp = askAuthority?.stamp;
          const session =
            'sessionToken' in request ? await auth.findSession(request.sessionToken) : undefined;
          if (!askAuthority && (!session || session.activeProjectId !== request.projectId)) deny();
          const principalId = askAuthority?.principalId ?? session!.principalId;
          const principal = askAuthority
            ? true
            : await auth.findPrincipal(principalId, 'session', session!.sessionId);
          const membership =
            askAuthority?.membership ?? (await auth.findMembership(principalId, request.projectId));
          if (!principal || !membership || !membership.scopes.length) deny();
          const lifecycle = await client.query<{
            status: string;
            revision: number;
            epoch: string;
            reset_state: string;
          }>(
            `SELECT project.status, project.revision, COALESCE(epoch.epoch, 0)::text AS epoch,
             COALESCE(epoch.state, 'READY') AS reset_state
           FROM project_admin.projects project LEFT JOIN project_admin.project_knowledge_epoch epoch ON epoch.project_id = project.id
           WHERE project.id = $1`,
            [request.projectId],
          );
          const project = lifecycle.rows[0];
          if (!project || project.status !== 'ACTIVE' || project.reset_state !== 'READY') deny();
          const policy = await client.query<{ revision: number | null }>(
            'SELECT MAX(revision) AS revision FROM settings.policy_context_revisions WHERE project_id = $1',
            [request.projectId],
          );
          const policyRevision = String(policy.rows[0]?.revision ?? 1);
          const context: SurferAccessContext = {
            spaceId: request.projectId,
            accessScope: [...membership.scopes].sort(),
            clearance: membership.sensitivityClearance,
          };
          const observed = await client.query<{ observed_at: Date }>(
            'SELECT transaction_timestamp() AS observed_at',
          );
          const observedAt = observed.rows[0]!.observed_at.toISOString();
          const accessDigest = surferDigest({
            principalId,
            scope: context,
            expiresAt: membership.expiresAt ?? null,
            projectRevision: project.revision,
            policyRevision,
          });
          if (routeBlocked)
            throw new ShotgunError({
              code: 'REVISION_CONFLICT',
              safeMessage:
                'Memory is temporarily unavailable. Try again after the storage operation finishes.',
              module: 'surfer.routing',
              operation: 'select-profile',
            });
          const sources = new PostgresOriginalAssetRepository(bound),
            transformations = new PostgresTransformationRepository(bound),
            evidence = new PostgresEvidenceRepository(bound);
          // Select latest before filtering ACL: never fall back to an older readable version.
          const latest = new Map<string, SourcesProjectionRecord>();
          for (const record of await sources.listProjectSourceVersions(request.projectId)) {
            if (
              !latest.has(record.sourceId) ||
              latest.get(record.sourceId)!.versionNumber < record.versionNumber
            )
              latest.set(record.sourceId, record);
          }
          const all = [...latest.values()].sort((a, b) =>
            a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0,
          );
          const visible = all.filter((r) =>
            allowed(context, {
              spaceId: request.projectId,
              accessScope: r.accessScope,
              sensitivity: r.sensitivity,
            }),
          );
          const heads: SurferSourceHead[] = [];
          const indexing = new Map<
            string,
            { evidence_set_digest: string; security_scope_digest: string; contract_version: string }
          >();
          for (const r of visible) {
            if (!r.originalAssetId)
              throw surferFailure('Stable OriginalAsset identity is unavailable.');
            const authority = r.activeEvidenceRevision;
            const revision = authority
              ? version2
                ? (
                    await client.query(
                      `SELECT revision_id::text, project_id, source_id::text, source_version_id::text,
                   source_content_hash, transformer_id, transformer_version, document_hash, source_map_hash,
                   access_scope, sensitivity, created_at::text
                   FROM transformation.revisions WHERE project_id=$1 AND source_version_id=$2 AND revision_id=$3`,
                      [request.projectId, r.sourceVersionId, authority.revisionId],
                    )
                  ).rows[0]
                : await transformations.findByRevision(
                    request.projectId,
                    r.sourceVersionId,
                    authority.revisionId,
                  )
              : undefined;
            if (authority) {
              const row = await client.query<{
                evidence_set_digest: string;
                security_scope_digest: string;
                contract_version: string;
              }>(
                'SELECT evidence_set_digest, security_scope_digest, contract_version FROM evidence.indexing_results WHERE project_id = $1 AND indexing_result_id = $2',
                [request.projectId, authority.indexingResultId],
              );
              if (row.rows[0]) indexing.set(r.sourceId, row.rows[0]);
            }
            let readiness: SurferSourceHead['readiness'] = 'UNAVAILABLE';
            if (
              authority &&
              (await sources.validateActiveEvidenceRevision({
                projectId: request.projectId,
                sourceId: r.sourceId,
                sourceVersionId: r.sourceVersionId,
                indexingResultId: authority.indexingResultId,
                revisionId: authority.revisionId,
              }))
            ) {
              if (
                r.stage3State === 'STAGE3_COMPLETED' &&
                authority.status === 'INDEXED' &&
                authority.evidenceCount > 0 &&
                !['image/png', 'image/jpeg'].includes(r.mediaType) &&
                !r.externalSourceRefreshFailed
              )
                readiness = 'INDEXED';
              else if (
                r.stage3State === 'NO_EVIDENCE' &&
                authority.status === 'NO_EVIDENCE' &&
                authority.evidenceCount === 0
              )
                readiness = 'NO_EVIDENCE';
            }
            heads.push({
              originalAssetId: r.originalAssetId,
              sourceId: r.sourceId,
              sourceVersionId: r.sourceVersionId,
              versionNumber: r.versionNumber,
              sourceContentHash: r.contentHash,
              scope: {
                spaceId: request.projectId,
                accessScope: [...r.accessScope].sort(),
                sensitivity: r.sensitivity,
              },
              observedAt: r.createdAt,
              readiness,
              revisionId: authority?.revisionId ?? null,
              indexingResultId: authority?.indexingResultId ?? null,
              fingerprint: surferDigest({
                source: r,
                transformation: revision ?? null,
                indexing: indexing.get(r.sourceId) ?? null,
              }),
            });
          }
          const intake = await client.query(
            'SELECT submission_id::text, state, submission_revision::text, updated_at FROM source_product.intake_submissions WHERE project_id = $1 ORDER BY submission_id',
            [request.projectId],
          );
          const intakeIdentity = intake.rows.map(
            (row: {
              submission_id: string;
              state: string;
              submission_revision: string;
              updated_at: Date;
            }) => ({ ...row, updated_at: row.updated_at.toISOString() }),
          );
          const snapshotContent = {
            projectId: request.projectId,
            principalId,
            context,
            canSynchronize: membership.isOwner,
            knowledgeEpoch: project.epoch,
            accessDigest,
            policyRevision,
            heads,
            catalogueDigest: surferDigest(all),
            intakeDigest: surferDigest(intakeIdentity),
          };
          const snapshot = {
            schemaVersion: '1.0.0' as const,
            ...snapshotContent,
            digest: surferDigest(snapshotContent),
            observedAt,
            coverage: {
              accessibleSources: heads.length,
              indexedSources: heads.filter((h) => h.readiness === 'INDEXED').length,
              unavailableSources: heads.filter((h) => h.readiness !== 'INDEXED').length,
              closedWorld: false as const,
            },
            consistency: 'SOURCE_KNOWLEDGE_AS_OF_SNAPSHOT' as const,
          };
          const metrics: SurferSourceReadMetricsV2 = {
            metadataHeads: heads.length,
            materialLoads: 0,
            proofReads: 0,
            cacheHits: 0,
            materialBytes: 0,
          };
          for (const [key, value] of this.cache) {
            const local =
              value.projectId === request.projectId && value.principalId === principalId;
            if (
              value.expiresAt <= Date.now() ||
              (local &&
                (value.accessDigest !== accessDigest ||
                  value.epoch !== project.epoch ||
                  !heads.some(
                    (h) =>
                      h.sourceId === value.sourceId &&
                      h.readiness === 'INDEXED' &&
                      (!version2 || h.fingerprint === value.fingerprint),
                  )))
            )
              this.cache.delete(key);
          }
          const loadMaterial = async (sourceId: string): Promise<SurferSourceMaterial> => {
            assertActive();
            metrics.materialLoads++;
            const head = heads.find((h) => h.sourceId === sourceId),
              record = visible.find((r) => r.sourceId === sourceId);
            if (!head || !record) deny();
            if (head.readiness !== 'INDEXED' || !head.revisionId || !head.indexingResultId)
              throw surferFailure(
                'Source material is not indexed/readable; absence is not a semantic result.',
              );
            const revision = await transformations.findByRevision(
              request.projectId,
              head.sourceVersionId,
              head.revisionId,
            );
            const spans = await evidence.listByRevision(
              request.projectId,
              head.sourceVersionId,
              head.revisionId,
            );
            if (!revision) throw surferFailure('Active source transformation is unavailable.');
            assertSurferJson(revision);
            registry.validateInput('surfer.bridge-revision', '1.0.0', revision);
            for (const span of spans) {
              assertSurferJson(span);
              registry.validateInput('surfer.bridge-evidence', '1.0.0', span);
            }
            if (
              revision.sourceId !== sourceId ||
              revision.sourceVersionId !== head.sourceVersionId ||
              revision.sourceContentHash !== head.sourceContentHash ||
              revision.documentIR.mediaType !== record.mediaType
            )
              throw surferFailure('Source transformation lineage/media type mismatch.');
            const expected = buildEvidenceCandidates(revision, locator);
            const indexed = indexing.get(sourceId);
            if (
              !indexed ||
              indexed.evidence_set_digest !==
                sha256Text(stableJson(spans.map((e) => e.evidenceId).sort())) ||
              indexed.security_scope_digest !==
                sha256Text(
                  stableJson({
                    accessScope: revision.accessScope,
                    sensitivity: revision.sensitivity,
                  }),
                )
            )
              throw surferFailure(
                'Indexing Evidence/security digest does not match the active set.',
              );
            if (
              new Set(spans.map((s) => s.evidenceId)).size !== spans.length ||
              spans.length !== expected.length ||
              spans.length !== record.activeEvidenceRevision?.evidenceCount
            )
              throw surferFailure('Active Evidence set is incomplete or duplicated.');
            const actual = new Map(spans.map((s) => [s.pointer, s]));
            if (actual.size !== spans.length)
              throw surferFailure('Duplicate active Evidence pointer.');
            for (const candidate of expected) {
              const found = actual.get(candidate.pointer);
              if (!found) throw surferFailure('Active Evidence pointer is missing.');
              const { evidenceId: _id, ...content } = found;
              if (
                surferDigest({ ...candidate, selectors: candidate.selectors ?? [] }) !==
                surferDigest({ ...content, selectors: content.selectors ?? [] })
              )
                throw surferFailure('Evidence does not match source map/quote/position/scope.');
            }
            const root = spans.find(
              (s) => s.pointer === '' && s.nodeKind === 'document' && s.origin === 'source',
            );
            if (!root) throw surferFailure('A source-origin document root witness is required.');
            const scopes = [
              head.scope,
              {
                spaceId: context.spaceId,
                accessScope: revision.accessScope,
                sensitivity: revision.sensitivity,
              },
              ...spans.map((s) => ({
                spaceId: context.spaceId,
                accessScope: s.accessScope,
                sensitivity: s.sensitivity,
              })),
            ];
            const scope: SurferScope = {
              spaceId: context.spaceId,
              accessScope: [...new Set(scopes.flatMap((s) => s.accessScope))].sort(),
              sensitivity: scopes.reduce(
                (a, s) => (levels[s.sensitivity] > levels[a] ? s.sensitivity : a),
                'public' as SurferScope['sensitivity'],
              ),
            };
            if (!allowed(context, scope)) deny();
            assertActive();
            const material: SurferSourceMaterial = structuredClone({
              schemaVersion: '1.0.0',
              originalAssetId: head.originalAssetId,
              sourceId,
              sourceVersionId: head.sourceVersionId,
              revisionId: head.revisionId,
              indexingResultId: head.indexingResultId,
              sourceContentHash: head.sourceContentHash,
              scope,
              documentIR: revision.documentIR,
              sourceMap: revision.sourceMap,
              evidence: spans,
              rootEvidenceId: root.evidenceId,
              documentHash: revision.documentHash,
              sourceMapHash: revision.sourceMapHash,
              transformer: revision.transformer,
              contentRole: 'UNTRUSTED_SOURCE_DATA',
              semanticAssessment: 'NOT_EVALUATED',
            });
            metrics.materialBytes += Buffer.byteLength(JSON.stringify(material));
            return material;
          };
          const proofCache = new Map<string, Promise<string>>();
          const loadProof = async (sourceId: string): Promise<string> => {
            assertActive();
            const h = heads.find((h) => h.sourceId === sourceId);
            if (!h || h.readiness !== 'INDEXED' || !h.revisionId || !h.indexingResultId) deny();
            metrics.proofReads++;
            // Hash current rows inside the DB. Matching IDs or a caller-provided digest cannot bypass grounding.
            const row = (
              await client.query<{ revision_proof: string; evidence_proof: string }>(
                `SELECT encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') AS revision_proof,
                 (SELECT encode(sha256(convert_to(COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.evidence_id),'[]'::jsonb)::text,'UTF8')),'hex')
                   FROM evidence.spans e WHERE e.project_id=$1 AND e.source_id=$2 AND e.source_version_id=$3 AND e.revision_id=$4) AS evidence_proof
               FROM transformation.revisions r WHERE r.project_id=$1 AND r.source_id=$2 AND r.source_version_id=$3 AND r.revision_id=$4`,
                [request.projectId, h.sourceId, h.sourceVersionId, h.revisionId],
              )
            ).rows[0];
            if (!row) throw surferFailure('Current Source content proof is unavailable.');
            assertActive();
            return surferDigest({ version: 'source-proof-v2', head: h.fingerprint, ...row });
          };
          const readContentProofV2 = async (sourceId: string) => {
            assertActive();
            let pending = proofCache.get(sourceId);
            if (!pending) {
              pending = loadProof(sourceId);
              proofCache.set(sourceId, pending);
            }
            const proof = await pending;
            assertActive();
            return proof;
          };
          const readMaterialV2 = async (sourceId: string) => {
            assertActive();
            const h = heads.find((h) => h.sourceId === sourceId);
            if (!h || h.readiness !== 'INDEXED') deny();
            const proof = await readContentProofV2(sourceId);
            assertActive();
            const key = surferDigest({
              validator: 'source-grounding-v1',
              projectId: request.projectId,
              principalId,
              accessDigest,
              epoch: project.epoch,
              sourceId,
              proof,
            });
            const cached = this.cache.get(key);
            if (cached && cached.expiresAt > Date.now()) {
              this.cache.delete(key);
              this.cache.set(key, cached);
              metrics.cacheHits++;
              return { material: structuredClone(cached.material), proof };
            }
            for (const [oldKey, old] of this.cache)
              if (
                old.projectId === request.projectId &&
                old.principalId === principalId &&
                old.sourceId === sourceId
              )
                this.cache.delete(oldKey);
            const material = await loadMaterial(sourceId),
              bytes = Buffer.byteLength(JSON.stringify(material));
            if (bytes <= 8 * 1024 * 1024) {
              this.cache.set(key, {
                projectId: request.projectId,
                principalId,
                accessDigest,
                epoch: project.epoch,
                sourceId,
                fingerprint: h.fingerprint,
                expiresAt: Date.now() + 30000,
                bytes,
                material: structuredClone(material),
                proof,
              });
              while (
                this.cache.size > 32 ||
                [...this.cache.values()].reduce((n, e) => n + e.bytes, 0) > 8 * 1024 * 1024
              )
                this.cache.delete(this.cache.keys().next().value!);
            }
            assertActive();
            return { material, proof };
          };
          let inflight = 0;
          let rowWriteFailed = false;
          async function track<R>(operation: () => Promise<R>): Promise<R> {
            assertActive();
            inflight++;
            try {
              return await operation();
            } catch (error) {
              if (rowMode === 'WRITE') rowWriteFailed = true;
              throw error;
            } finally {
              inflight--;
            }
          }
          const store = rowMode
            ? null
            : version2
              ? bindSurferKnowledgeSession(client, context.spaceId, assertActive, !!askRequest)
              : bindSurferKnowledgeStore(client, context.spaceId, assertActive);
          const bindingStore =
            !rowMode && version2
              ? bindSurferBindingSessionV2(client, context.spaceId, assertActive, !!askRequest)
              : null;
          if (rowMode) {
            const route = (
              await client.query<{ mode: string }>(
                'SELECT mode FROM surfer_rows.route WHERE space_id=$1',
                [context.spaceId],
              )
            ).rows[0];
            if (
              route &&
              !(route.mode === 'ROWS' || (rowMode === 'READ' && route.mode === 'SUSPENDED'))
            )
              deny();
          }
          const rowCore = rowMode
            ? bindSurferKnowledgeRowsSession(client, context, assertActive, rowMode === 'READ')
            : null;
          const rowBindings = rowMode
            ? bindSurferRowsBindings(client, context.spaceId, assertActive, rowMode === 'READ')
            : null;
          const result = await action({
            routeProfile: rowMode ? 'ROWS' : 'LEGACY',
            readOnly: !!askRequest,
            snapshot: structuredClone(snapshot),
            readMaterial: (id) =>
              track(async () =>
                version2 ? (await readMaterialV2(id)).material : loadMaterial(id),
              ),
            ...(store
              ? {
                  store: {
                    ...(store.read
                      ? {
                          read: <R>(spaceId: string, apply: (state: SurferKnowledgeState) => R) =>
                            track(() => store.read!(spaceId, apply)),
                        }
                      : {}),
                    transaction: (spaceId, apply) => track(() => store.transaction(spaceId, apply)),
                  },
                }
              : {}),
            ...(bindingStore
              ? {
                  bindingStore: {
                    ...(bindingStore.read
                      ? {
                          read: <R>(spaceId: string, apply: (state: SurferBindingStateV2) => R) =>
                            track(() => bindingStore.read!(spaceId, apply)),
                        }
                      : {}),
                    transaction: <R>(spaceId: string, apply: (state: SurferBindingStateV2) => R) =>
                      track(() => bindingStore.transaction(spaceId, apply)),
                  },
                  readMaterialV2: (id: string) => track(() => readMaterialV2(id)),
                  metrics,
                  readContentProofV2: (id: string) => track(() => readContentProofV2(id)),
                }
              : {}),
            ...(version2
              ? {
                  readMaterialV2: (id: string) => track(() => readMaterialV2(id)),
                  metrics,
                  readContentProofV2: (id: string) => track(() => readContentProofV2(id)),
                }
              : {}),
            ...(rowCore && rowBindings
              ? {
                  core: {
                    initialize: () => track(() => rowCore.initialize()),
                    lookupInput: (id: string) => track(() => rowCore.lookupInput(id)),
                    hasOperation: (id: string) => track(() => rowCore.hasOperation(id)),
                    findCommit: (id: string) => track(() => rowCore.findCommit(id)),
                    priorCreatedAt: (id: string) => track(() => rowCore.priorCreatedAt(id)),
                    currentSnapshotId: () => track(() => rowCore.currentSnapshotId()),
                    execute: (c: Parameters<typeof rowCore.execute>[0]) =>
                      track(() => rowCore.execute(c)),
                    captureBasis: (r: Parameters<typeof rowCore.captureBasis>[0]) =>
                      track(() => rowCore.captureBasis(r)),
                    readClosure: (r: Parameters<typeof rowCore.readClosure>[0]) =>
                      track(() => rowCore.readClosure(r)),
                  },
                  bindings: {
                    captureIssued: (b: Parameters<typeof rowBindings.captureIssued>[0]) =>
                      track(() => rowBindings.captureIssued(b)),
                    issueCapture: (b: Parameters<typeof rowBindings.issueCapture>[0]) =>
                      track(() => rowBindings.issueCapture(b)),
                    binding: (r: Parameters<typeof rowBindings.binding>[0]) =>
                      track(() => rowBindings.binding(r)),
                    bind: (r: Parameters<typeof rowBindings.bind>[0]) =>
                      track(() => rowBindings.bind(r)),
                  },
                }
              : {}),
          });
          if (inflight)
            throw surferFailure(
              'Source session has unawaited operations; transaction cannot commit.',
            );
          if (rowWriteFailed)
            throw surferFailure(
              'A row Source operation failed; partial transaction cannot commit.',
            );
          return rowMode ? structuredClone(result) : result;
        } finally {
          active = false;
        }
      },
      {
        module: 'surfer.source',
        operation: 'source-knowledge-session',
        isolationLevel: 'REPEATABLE READ',
        ...(rowMode === 'READ' || askRequest ? { readOnly: true } : {}),
      },
    );
    // A fresh statement after the MVCC callback detects cancellation, expiry and authority changes.
    if (askRequest && (await authorizeSurferAskRead(this.pool, askRequest)).stamp !== askStamp)
      denySurferAskRead();
    return result;
  }
}
