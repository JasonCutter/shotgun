import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresSourceRefreshStore } from '../../adapters/source-refresh-postgres/src/index.js';
import { SourceRefreshCoordinator } from '../../modules/frontend-sources-write/src/source-refresh.js';
import { SealedSourcesStagingService } from '../../adapters/frontend-sources-staging-sealed/src/index.js';
import { PostgresSourcesProductService } from '../../adapters/frontend-sources-write-postgres/src/product-service.js';
import { InMemoryAssetStorage } from '../../adapters/stage2-in-memory/src/index.js';
import { PostgresOriginalAssetRepository } from '../../adapters/postgres/src/index.js';
import { SecureUrlAcquisitionCoordinator } from '../../modules/url-acquisition/src/index.js';
import type { SourcesProductWriteScope } from '../../modules/frontend-sources-write/src/product-service.js';
import {
  createIsolatedPostgresTestDatabase,
  type IsolatedPostgresTestDatabase,
} from '../helpers/isolated-postgres-test-database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';
import { ShotgunError } from '../../packages/contracts/src/index.js';

const target = await requireTestDatabaseTarget();
const hash = (value: string) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
let database: IsolatedPostgresTestDatabase;
let pool: Pool;
describe.skipIf(!target)(
  'durable URL refresh on isolated PostgreSQL with fake bounded acquisition',
  () => {
    beforeAll(async () => {
      database = await createIsolatedPostgresTestDatabase();
      pool = database.createPool();
    }, 60_000);
    afterAll(async () => {
      await database?.dispose();
    });

    async function fixture(pastRefreshes = 0) {
      // Only this suite's disposable database is used. No live transport exists.
      const principalId = randomUUID(),
        sessionId = randomUUID(),
        projectId = `url-refresh-${randomUUID()}`;
      const now = new Date().toISOString();
      await pool.query(
        `INSERT INTO auth.principals(principal_id,actor_type,status,account_id,created_at)
      VALUES ($1,'user','active',$2,$3)`,
        [principalId, `fixture-${principalId}`, now],
      );
      await pool.query(
        `INSERT INTO project_admin.projects(id,name,status,active,created_at,updated_at,revision)
      VALUES ($1,'URL refresh fixture','ACTIVE',true,$2,$2,1)`,
        [projectId, now],
      );
      await pool.query(
        `INSERT INTO auth.project_memberships(principal_id,project_id,scopes,sensitivity_clearance,is_owner)
      VALUES ($1,$2,'{owner}','private',true)`,
        [principalId, projectId],
      );
      await pool.query(
        `INSERT INTO auth.sessions(session_id,token_hash,csrf_hash,principal_id,active_project_id,expires_at,created_at)
      VALUES ($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour',$6)`,
        [sessionId, hash(sessionId), hash(`csrf-${sessionId}`), principalId, projectId, now],
      );
      const scope: SourcesProductWriteScope = {
        principalId,
        sessionId,
        projectId,
        principalAccessScopes: ['owner'],
        sensitivityClearance: 'private',
        resourceSecurityPolicy: {
          allowedClassifications: ['private'],
          resourceAccessScope: ['owner'],
        },
        accessRevision: '1',
        policyContextRevision: '1',
        acceptedPolicyContextId: `policy/${projectId}`,
        acceptedPolicyBinding: {},
      };
      async function accept(commandId: string) {
        await pool.query(
          `INSERT INTO frontend_command.command_ledger (
        command_id,command_revision,client_request_id,idempotency_key,principal_id,envelope_version,scope_kind,
        active_project_id,target_project_id,resource_project_id,scope_binding_key,command_type,command_schema_version,
        command_semantic_digest,policy_binding,accepted_principal_context,accepted_project_context,accepted_policy_context,
        preconditions,command_payload,outcome_state,completion_disposition,produced_resources,rejection,correlation_id,trace_id,
        received_at,accepted_at,completed_at,last_updated_at)
        VALUES ($1,1,$2,$3,$4,'2.0.0','PROJECT',$5,$5,NULL,$6,'sources.intake.submit.v1','1.0.0',
          $7,'{"mode":"CURRENT"}',$8,$9,$10,'[]','{}','ACCEPTED',NULL,'[]',NULL,$11,$12,$13,$13,NULL,$13)`,
          [
            commandId,
            `client-${commandId}`,
            `idem-${commandId}`,
            principalId,
            projectId,
            JSON.stringify({ envelopeVersion: '2.0.0', scope: 'PROJECT', projectId }),
            hash(commandId),
            JSON.stringify({ principalId }),
            JSON.stringify({ activeProjectId: projectId, targetProjectId: projectId }),
            JSON.stringify({ policyContextId: `policy/${projectId}`, policyContextRevision: '1' }),
            `correlation-${commandId}`,
            `trace-${commandId}`,
            now,
          ],
        );
      }
      let body = 'Count is 42.';
      let calls = 0;
      let failing = false;
      const acquisition = new SecureUrlAcquisitionCoordinator(
        { resolve: async () => ['93.184.216.34'] },
        {
          request: async () => {
            calls++;
            if (failing)
              throw new ShotgunError({
                code: 'RETRYABLE_DEPENDENCY',
                safeMessage: 'Fake acquisition failure',
                module: 'url-acquisition-node',
                operation: 'request',
                retryable: true,
              });
            return {
              status: 200,
              connectedAddress: '93.184.216.34',
              headers: { 'content-type': 'text/plain' },
              body: Buffer.from(body),
              compressedBytes: Buffer.byteLength(body),
            };
          },
        },
      );
      const storage = new InMemoryAssetStorage();
      const staging = new SealedSourcesStagingService(
        storage,
        'url-refresh-test-staging-key-32-characters',
        acquisition,
        () =>
          calls <= pastRefreshes + 1
            ? new Date(Date.now() - 25 * 60 * 60 * 1000 + calls)
            : new Date(),
      );
      const product = new PostgresSourcesProductService(pool, staging);
      const draftId = randomUUID(),
        itemId = randomUUID(),
        commandId = randomUUID();
      await accept(commandId);
      const receipt = await staging.stageUrl({
        draftId,
        itemId,
        projectId,
        principalId,
        label: 'URL fixture',
        requestedUrl: `https://example.org/${projectId}.txt`,
      });
      const artifact = await staging.resolve({
        stagingReference: receipt.stagingReference,
        draftId,
        itemId,
        projectId,
        principalId,
        kind: 'URL',
      });
      const initial = await product.submit({
        submissionId: randomUUID(),
        commandId,
        correlationId: randomUUID(),
        draftId,
        scope,
        items: [{ ...artifact, requestedClassification: 'private' }],
        duplicateHandling: 'AUTOMATIC',
        createdAt: now,
      });
      const sourceId = initial.items[0]!.producedResource!.sourceId;
      const v1 = initial.items[0]!.producedResource!.sourceVersionId;
      const store = new PostgresSourceRefreshStore(pool);
      const authorization = {
        authorize: async (): Promise<SourcesProductWriteScope | undefined> => scope,
        prepareSubmission: async (job: { commandId: string }) => accept(job.commandId),
      };
      const coordinator = new SourceRefreshCoordinator(store, authorization, staging, product);
      return {
        projectId,
        sourceId,
        v1,
        store,
        coordinator,
        calls: () => calls,
        setBody: (value: string) => {
          body = value;
        },
        fail: () => {
          failing = true;
        },
        authorization,
        advanceSource: async () => {
          const nextCommand = randomUUID();
          await accept(nextCommand);
          const nextDraft = randomUUID(),
            nextItem = randomUUID();
          const staged = await staging.stageBytes({
            draftId: nextDraft,
            itemId: nextItem,
            projectId,
            principalId,
            kind: 'DIRECT_TEXT',
            label: 'Concurrent user edit',
            mediaType: 'text/plain',
            bytes: Buffer.from('User supplied count is 99.'),
          });
          const edit = await staging.resolve({
            stagingReference: staged.stagingReference,
            draftId: nextDraft,
            itemId: nextItem,
            projectId,
            principalId,
            kind: 'DIRECT_TEXT',
          });
          return product.submit({
            submissionId: randomUUID(),
            commandId: nextCommand,
            correlationId: randomUUID(),
            draftId: nextDraft,
            scope,
            items: [{ ...edit, requestedSourceId: sourceId, requestedClassification: 'private' }],
            duplicateHandling: 'AUTOMATIC',
            createdAt: new Date().toISOString(),
          });
        },
      };
    }

    it('reuses unchanged version, versions changed bytes and preserves original receipt/body', async () => {
      const f = await fixture(1);
      const original = (
        await pool.query(
          `SELECT content_hash,original_asset_id,source_version_id FROM source_product.url_provenance_receipts WHERE project_id=$1`,
          [f.projectId],
        )
      ).rows[0];
      expect(await f.coordinator.drainOnce('worker')).toBe('SUCCEEDED');
      expect(
        (
          await pool.query(`SELECT count(*)::int n FROM asset.source_versions WHERE source_id=$1`, [
            f.sourceId,
          ])
        ).rows[0].n,
      ).toBe(1);
      f.setBody('Count is 43.');
      expect(await f.coordinator.drainOnce('worker')).toBe('SUCCEEDED');
      const versions = (
        await pool.query(
          `SELECT version_number,source_version_id::text FROM asset.source_versions WHERE source_id=$1 ORDER BY version_number`,
          [f.sourceId],
        )
      ).rows;
      expect(versions.map((v) => v.version_number)).toEqual([1, 2]);
      expect(versions[0].source_version_id).toBe(f.v1);
      expect(
        (
          await pool.query(
            `SELECT content_hash,original_asset_id,source_version_id FROM source_product.url_provenance_receipts WHERE project_id=$1 ORDER BY created_at LIMIT 1`,
            [f.projectId],
          )
        ).rows[0],
      ).toEqual(original);
      expect(f.calls()).toBe(3);
    });
    it('claims one job across independent connections and fences duplicate activation', async () => {
      const f = await fixture();
      const claims = await Promise.all([
        f.store.claimNext('one'),
        new PostgresSourceRefreshStore(database.createPool()).claimNext('two'),
      ]);
      expect(claims.filter(Boolean)).toHaveLength(1);
      const job = claims.find(Boolean)!;
      await f.store.transition({ job, phase: 'ACQUIRING' });
      await expect(f.store.transition({ job, phase: 'ACQUIRING' })).rejects.toThrow(
        'lease or phase',
      );
      await pool.query(
        `UPDATE source_product.url_refresh_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE job_id=$1`,
        [job.jobId],
      );
      expect(await f.store.claimNext('restart')).toBeUndefined();
      expect(
        (
          await pool.query(`SELECT phase FROM source_product.url_refresh_jobs WHERE job_id=$1`, [
            job.jobId,
          ])
        ).rows[0].phase,
      ).toBe('OUTCOME_UNKNOWN');
      expect(f.calls()).toBe(1);
    });
    it('journals failed refresh with bounded retries and no new SourceVersion', async () => {
      const f = await fixture();
      f.fail();
      for (let attempt = 0; attempt < 3; attempt++) {
        expect(await f.coordinator.drainOnce('worker')).toBe('FAILED');
        await pool.query(
          `UPDATE source_product.url_refresh_jobs SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE project_id=$1`,
          [f.projectId],
        );
      }
      expect(await f.coordinator.drainOnce('worker')).toBe('IDLE');
      expect(
        (
          await pool.query(
            `SELECT phase,attempts,safe_failure_code FROM source_product.url_refresh_jobs WHERE project_id=$1`,
            [f.projectId],
          )
        ).rows[0],
      ).toMatchObject({
        phase: 'FAILED',
        attempts: 3,
        safe_failure_code: 'URL_REFRESH_ACQUISITION_FAILED',
      });
      expect(
        (
          await pool.query(`SELECT count(*)::int n FROM asset.source_versions WHERE source_id=$1`, [
            f.sourceId,
          ])
        ).rows[0].n,
      ).toBe(1);
      expect(f.calls()).toBe(4);
      const records = await new PostgresOriginalAssetRepository(pool).listProjectSourceVersions(
        f.projectId,
      );
      expect(
        records.find((record) => record.sourceVersionId === f.v1)?.externalSourceRefreshFailed,
      ).toBe(true);
    });
    it('rejects refresh after a concurrent user version commits between authorization and submit', async () => {
      const f = await fixture();
      const originalPrepare = f.authorization.prepareSubmission;
      f.authorization.prepareSubmission = async (job) => {
        await originalPrepare(job);
        await f.advanceSource();
      };
      expect(await f.coordinator.drainOnce('worker')).toBe('FAILED');
      expect(
        (
          await pool.query(`SELECT count(*)::int n FROM asset.source_versions WHERE source_id=$1`, [
            f.sourceId,
          ])
        ).rows[0].n,
      ).toBe(2);
      expect(
        (
          await pool.query(
            `SELECT phase,safe_failure_code FROM source_product.url_refresh_jobs WHERE project_id=$1`,
            [f.projectId],
          )
        ).rows[0],
      ).toMatchObject({ phase: 'FAILED', safe_failure_code: 'REFRESH_SOURCE_VERSION_CHANGED' });
      expect(f.calls()).toBe(2);
      const records = await new PostgresOriginalAssetRepository(pool).listProjectSourceVersions(
        f.projectId,
      );
      expect(
        records.find((record) => record.versionNumber === 2)?.externalSourceRefreshFailed,
      ).toBeUndefined();
    });
    it('preserves paused backlog and consumes no acquisition attempt while standing authority is disabled', async () => {
      const f = await fixture();
      const allowed = f.authorization.authorize;
      f.authorization.authorize = async () => undefined;
      expect(await f.coordinator.drainOnce('worker')).toBe('FAILED');
      expect(f.calls()).toBe(1);
      expect(
        (
          await pool.query(
            `SELECT attempts FROM source_product.url_refresh_jobs WHERE project_id=$1`,
            [f.projectId],
          )
        ).rows[0].attempts,
      ).toBe(0);
      await pool.query(
        `UPDATE source_product.url_refresh_jobs SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE project_id=$1`,
        [f.projectId],
      );
      f.authorization.authorize = allowed;
      expect(await f.coordinator.drainOnce('worker')).toBe('SUCCEEDED');
      expect(f.calls()).toBe(2);
    });
    it('does not select or acquire source work while the existing project reset fence is active', async () => {
      const f = await fixture();
      await pool.query(
        `INSERT INTO project_admin.project_knowledge_epoch(project_id,state) VALUES($1,'RESET_PENDING')`,
        [f.projectId],
      );
      expect(await f.coordinator.drainOnce('worker')).toBe('IDLE');
      expect(f.calls()).toBe(1);
      expect(
        (
          await pool.query(
            'SELECT count(*)::int n FROM source_product.url_refresh_jobs WHERE project_id=$1',
            [f.projectId],
          )
        ).rows[0].n,
      ).toBe(0);
    });
  },
);
