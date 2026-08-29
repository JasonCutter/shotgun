import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { PostgresDiscoveryFindingRepository } from '../../adapters/discovery-finding-postgres/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import {
  createDiscoveryFindingEnvelopeV1,
  type DiscoveryFindingEnvelopeInputV1,
  type DiscoveryFindingPayloadV1,
  type DiscoveryFindingProvenanceV1,
  type DiscoveryResourceRefV1,
} from '../../packages/contracts/src/index.js';
import {
  DiscoveryFindingLifecycleService,
  type DiscoveryFindingIdentityV1,
} from '../../modules/discovery-finding-lifecycle/src/index.js';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim()
  ? await requireTestDatabaseTarget()
  : undefined;
const projectIds = new Set<string>();

const projectId = (label: string): string => {
  const value = `akp-2-wp3-${label}-${randomUUID()}`;
  projectIds.add(value);
  return value;
};

const deterministic: DiscoveryFindingProvenanceV1 = {
  schemaVersion: '1.0.0',
  kind: 'DETERMINISTIC',
  ruleId: 'discovery.wp3.test',
  ruleVersion: '1',
  inputDigest: 'sha256:wp3-input',
};

const makeFinding = (input: {
  readonly projectId: string;
  readonly findingId: string;
  readonly fingerprint?: string;
  readonly lifecycleState?: DiscoveryFindingEnvelopeInputV1['lifecycleState'];
}): ReturnType<typeof createDiscoveryFindingEnvelopeV1> => {
  const claim: DiscoveryResourceRefV1 = {
    schemaVersion: '1.0.0',
    resourceKind: 'CANONICAL_CLAIM',
    resourceId: 'claim-1',
    projectId: input.projectId,
    resourceState: 'CURRENT',
    resourceRevision: '3',
  };
  const payload: DiscoveryFindingPayloadV1 = {
    schemaVersion: '1.0.0',
    payloadType: 'EVIDENCE_GAP',
    coverageKind: 'INSUFFICIENT',
    affectedResourceRef: claim,
    coverageGap: 'The current claim has insufficient evidence.',
    requiredEvidence: 'A current supporting source is required.',
  };
  return createDiscoveryFindingEnvelopeV1({
    schemaVersion: '1.0.0',
    findingId: input.findingId,
    findingRevision: 1,
    projectId: input.projectId,
    findingType: 'EVIDENCE_GAP',
    generationMethod: 'DETERMINISTIC',
    lifecycleState: input.lifecycleState ?? 'NEW',
    payload,
    relatedResourceRefs: [claim],
    evidenceIds: ['evidence-1'],
    sourceProjectionDigest: 'sha256:source-projection',
    canonicalBase: {
      schemaVersion: '1.0.0',
      canonicalVersion: 7,
      snapshotDigest: 'sha256:canonical-snapshot',
    },
    discoveryBase: {
      schemaVersion: '1.0.0',
      projectionRevision: 'projection-7',
      projectionDigest: 'sha256:discovery-projection',
    },
    runId: 'run-wp3-1',
    signalSummary: { evidenceCoverage: 0.4 },
    rationale: 'A bounded discovery signal is retained for review.',
    derivationSummary: 'Derived from a pinned project projection and evidence.',
    provenance: deterministic,
    accessScope: ['owner'],
    sensitivity: 'internal',
    fingerprint: input.fingerprint ?? 'sha256:wp3-fingerprint',
    fingerprintVersion: 'discovery-fingerprint:v1',
    retentionClass: 'DURABLE_DERIVED_RECORD',
    createdAt: '2026-08-29T00:00:00.000Z',
  });
};

const identityOf = (finding: ReturnType<typeof makeFinding>): DiscoveryFindingIdentityV1 => ({
  projectId: finding.projectId,
  findingId: finding.findingId,
  findingRevision: finding.findingRevision,
});

describe.runIf(databaseUrl)('AKP-2 WP3 Discovery lifecycle PostgreSQL persistence', () => {
  const pool: Pool = createPostgresPool(databaseUrl!);

  beforeAll(async () => {
    await migrateUpTo(undefined, databaseUrl!);
  });

  afterAll(async () => {
    for (const project of projectIds) {
      await pool.query('DELETE FROM discovery.finding_lifecycle_history WHERE project_id = $1', [
        project,
      ]);
      await pool.query('DELETE FROM discovery.finding_lifecycle_current WHERE project_id = $1', [
        project,
      ]);
      await pool.query('DELETE FROM discovery.findings WHERE project_id = $1', [project]);
    }
    await pool.end();
  });

  it('applies migration 046 after WP2 and creates scoped lookup/current/history authority', async () => {
    const result = await pool.query<{
      current_table: string | null;
      history_table: string | null;
      fingerprint_index: string | null;
    }>(
      `SELECT to_regclass('discovery.finding_lifecycle_current')::text AS current_table,
              to_regclass('discovery.finding_lifecycle_history')::text AS history_table,
              (SELECT indexname FROM pg_indexes
               WHERE schemaname = 'discovery'
                 AND indexname = 'discovery_findings_fingerprint_lookup_idx') AS fingerprint_index`,
    );
    expect(result.rows[0]).toEqual({
      current_table: 'discovery.finding_lifecycle_current',
      history_table: 'discovery.finding_lifecycle_history',
      fingerprint_index: 'discovery_findings_fingerprint_lookup_idx',
    });
  });

  it('atomically initializes a new finding and round-trips separate lifecycle history', async () => {
    const finding = makeFinding({
      projectId: projectId('atomic'),
      findingId: 'finding-atomic',
    });
    const repository = new PostgresDiscoveryFindingRepository(pool);
    expect(await repository.save(finding)).toBe('CREATED');
    expect(await repository.findLifecycle(identityOf(finding))).toEqual({
      ...identityOf(finding),
      lifecycleState: 'NEW',
      lifecycleRevision: 1,
      updatedAt: finding.createdAt,
    });
    expect(await repository.listLifecycleHistory(identityOf(finding))).toEqual([
      {
        ...identityOf(finding),
        lifecycleRevision: 1,
        toState: 'NEW',
        cause: 'MATERIALIZATION',
        reasonCode: 'FINDING_MATERIALIZED',
        canonicalBase: finding.canonicalBase,
        discoveryBase: finding.discoveryBase,
        occurredAt: finding.createdAt,
      },
    ]);
  });

  it('keeps immutable finding authority unchanged through valid transitions and rejects stale writes', async () => {
    const finding = makeFinding({
      projectId: projectId('transition'),
      findingId: 'finding-transition',
    });
    const repository = new PostgresDiscoveryFindingRepository(pool);
    const service = new DiscoveryFindingLifecycleService(repository);
    const identity = identityOf(finding);
    expect(await repository.save(finding)).toBe('CREATED');
    const before = await pool.query(
      `SELECT lifecycle_state, payload, related_resource_refs, provenance,
              access_scope, sensitivity, project_id, fingerprint
       FROM discovery.findings
       WHERE project_id = $1 AND finding_id = $2 AND finding_revision = $3`,
      [identity.projectId, identity.findingId, identity.findingRevision],
    );

    expect(
      await service.transition({
        ...identity,
        expectedLifecycleRevision: 1,
        targetState: 'VALIDATING',
        cause: 'GOVERNED_WORKFLOW',
        reasonCode: 'VALIDATION_STARTED',
        occurredAt: '2026-08-29T00:01:00.000Z',
      }),
    ).toMatchObject({ status: 'APPLIED', lifecycle: { lifecycleRevision: 2 } });
    expect(
      await service.transition({
        ...identity,
        expectedLifecycleRevision: 2,
        targetState: 'REVIEW_READY',
        cause: 'GOVERNED_WORKFLOW',
        reasonCode: 'REVIEW_READY',
        occurredAt: '2026-08-29T00:02:00.000Z',
      }),
    ).toMatchObject({ status: 'APPLIED', lifecycle: { lifecycleRevision: 3 } });
    expect(
      await service.transition({
        ...identity,
        expectedLifecycleRevision: 3,
        targetState: 'REENTERED',
        cause: 'GOVERNED_WORKFLOW',
        reasonCode: 'REENTERED',
        occurredAt: '2026-08-29T00:03:00.000Z',
      }),
    ).toMatchObject({ status: 'APPLIED', lifecycle: { lifecycleRevision: 4 } });

    const stale = await service.transition({
      ...identity,
      expectedLifecycleRevision: 1,
      targetState: 'RESOLVED',
      cause: 'SYSTEM_RECONCILIATION',
      reasonCode: 'CANONICAL_EQUIVALENT_ACCEPTED',
      occurredAt: '2026-08-29T00:04:00.000Z',
    });
    expect(stale.status).toBe('CONFLICT');
    expect(await repository.listLifecycleHistory(identity)).toHaveLength(4);

    const after = await pool.query(
      `SELECT lifecycle_state, payload, related_resource_refs, provenance,
              access_scope, sensitivity, project_id, fingerprint
       FROM discovery.findings
       WHERE project_id = $1 AND finding_id = $2 AND finding_revision = $3`,
      [identity.projectId, identity.findingId, identity.findingRevision],
    );
    expect(after.rows).toEqual(before.rows);
  });

  it('maps each bounded reconciliation disposition and persists supplied base context', async () => {
    const repository = new PostgresDiscoveryFindingRepository(pool);
    const service = new DiscoveryFindingLifecycleService(repository);
    const cases = [
      ['CANONICAL_EQUIVALENT_ACCEPTED', 'RESOLVED'],
      ['SOURCE_MATERIALLY_SUPERSEDED', 'SUPERSEDED'],
      ['RELEVANT_INPUT_CHANGED', 'STALE'],
    ] as const;
    for (const [disposition, targetState] of cases) {
      const finding = makeFinding({
        projectId: projectId(`reconcile-${targetState.toLowerCase()}`),
        findingId: `finding-${targetState.toLowerCase()}`,
      });
      const identity = identityOf(finding);
      expect(await repository.save(finding)).toBe('CREATED');
      const result = await service.reconcile({
        finding,
        expectedLifecycleRevision: 1,
        observation: {
          ...identity,
          disposition,
          canonicalBase: {
            schemaVersion: '1.0.0',
            canonicalVersion: 8,
            snapshotDigest: 'sha256:current-canonical',
          },
          discoveryBase: {
            schemaVersion: '1.0.0',
            projectionRevision: 'projection-8',
            projectionDigest: 'sha256:current-discovery',
          },
        },
        occurredAt: '2026-08-29T00:05:00.000Z',
      });
      expect(result.status).toBe('TRANSITIONED');
      expect(await repository.findLifecycle(identity)).toMatchObject({
        lifecycleState: targetState,
        lifecycleRevision: 2,
      });
      expect(await repository.listLifecycleHistory(identity)).toMatchObject([
        {},
        {
          toState: targetState,
          reasonCode: disposition,
          canonicalBase: { canonicalVersion: 8 },
          discoveryBase: { projectionRevision: 'projection-8' },
        },
      ]);
    }
  });

  it('keeps unchanged reconciliation a no-op and isolates exact fingerprint lookup by project', async () => {
    const repository = new PostgresDiscoveryFindingRepository(pool);
    const projectA = projectId('lookup-a');
    const projectB = projectId('lookup-b');
    const findingA = makeFinding({
      projectId: projectA,
      findingId: 'a',
      fingerprint: 'sha256:same',
    });
    const findingB = makeFinding({
      projectId: projectB,
      findingId: 'b',
      fingerprint: 'sha256:same',
    });
    expect(await repository.save(findingA)).toBe('CREATED');
    expect(await repository.save(findingB)).toBe('CREATED');
    expect(
      await repository.findByFingerprint(
        projectA,
        findingA.fingerprintVersion,
        findingA.fingerprint,
      ),
    ).toEqual([identityOf(findingA)]);
    expect(
      await repository.findByFingerprint(
        projectB,
        findingB.fingerprintVersion,
        findingB.fingerprint,
      ),
    ).toEqual([identityOf(findingB)]);
    const service = new DiscoveryFindingLifecycleService(repository);
    const unchanged = await service.reconcile({
      finding: findingA,
      expectedLifecycleRevision: 1,
      observation: { ...identityOf(findingA), disposition: 'UNCHANGED' },
      occurredAt: '2026-08-29T00:06:00.000Z',
    });
    expect(unchanged.status).toBe('UNCHANGED');
    expect(await repository.listLifecycleHistory(identityOf(findingA))).toHaveLength(1);
  });

  it('preserves dismissal/suppression paths and fails closed for illegal terminal reversal', async () => {
    const repository = new PostgresDiscoveryFindingRepository(pool);
    const service = new DiscoveryFindingLifecycleService(repository);
    for (const targetState of ['DISMISSED', 'SUPPRESSED'] as const) {
      const finding = makeFinding({
        projectId: projectId(`workflow-${targetState.toLowerCase()}`),
        findingId: `finding-${targetState.toLowerCase()}`,
      });
      const identity = identityOf(finding);
      expect(await repository.save(finding)).toBe('CREATED');
      expect(
        await service.transition({
          ...identity,
          expectedLifecycleRevision: 1,
          targetState: 'VALIDATING',
          cause: 'GOVERNED_WORKFLOW',
          reasonCode: 'VALIDATION_STARTED',
          occurredAt: '2026-08-29T00:07:00.000Z',
        }),
      ).toMatchObject({ status: 'APPLIED' });
      expect(
        await service.transition({
          ...identity,
          expectedLifecycleRevision: 2,
          targetState,
          cause: 'GOVERNED_WORKFLOW',
          reasonCode: targetState,
          occurredAt: '2026-08-29T00:08:00.000Z',
        }),
      ).toMatchObject({ status: 'APPLIED', lifecycle: { lifecycleState: targetState } });
    }
    const terminal = makeFinding({
      projectId: projectId('terminal'),
      findingId: 'finding-terminal',
    });
    const terminalIdentity = identityOf(terminal);
    expect(await repository.save(terminal)).toBe('CREATED');
    expect(
      await service.transition({
        ...terminalIdentity,
        expectedLifecycleRevision: 1,
        targetState: 'VALIDATING',
        cause: 'GOVERNED_WORKFLOW',
        reasonCode: 'VALIDATION_STARTED',
        occurredAt: '2026-08-29T00:09:00.000Z',
      }),
    ).toMatchObject({ status: 'APPLIED' });
    expect(
      await service.reconcile({
        finding: terminal,
        expectedLifecycleRevision: 2,
        observation: { ...terminalIdentity, disposition: 'RELEVANT_INPUT_CHANGED' },
        occurredAt: '2026-08-29T00:10:00.000Z',
      }),
    ).toMatchObject({ status: 'TRANSITIONED' });
    await expect(
      service.reconcile({
        finding: terminal,
        expectedLifecycleRevision: 3,
        observation: { ...terminalIdentity, disposition: 'CANONICAL_EQUIVALENT_ACCEPTED' },
        occurredAt: '2026-08-29T00:11:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(await repository.listLifecycleHistory(terminalIdentity)).toHaveLength(3);
  });
});
