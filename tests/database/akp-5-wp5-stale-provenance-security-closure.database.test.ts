import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import {
  PostgresDiscoveryApprovedResourceRevisionResolver,
  PostgresDiscoveryReentryFreshnessAuthority,
  PostgresDiscoveryReentryRepository,
} from '../../adapters/discovery-reentry-postgres/src/index.js';
import { PostgresDiscoveryFindingRepository } from '../../adapters/discovery-finding-postgres/src/index.js';
import {
  PostgresDiscoveryReviewResourceRepository,
  createPostgresReviewDiscoveryCandidateReader,
} from '../../adapters/frontend-review-postgres/src/index.js';
import {
  createPostgresPool,
  PostgresOriginalAssetRepository,
} from '../../adapters/postgres/src/index.js';
import {
  PostgresEvidenceRepository,
  PostgresTransformationRepository,
} from '../../adapters/postgres-stage3/src/index.js';
import {
  DiscoveryReentryConsumer,
  DiscoveryReentryFreshnessEvaluator,
  DiscoveryReviewMaterializer,
  discoveryReentryFreshnessBindingFromReviewResourceV1,
  discoveryReentryFreshnessBindingFromFindingV1,
  type DiscoveryReviewResourceWriterPort,
} from '../../modules/discovery-reentry/src/index.js';
import { buildEvidenceCandidates } from '../../modules/evidence/src/index.js';
import {
  createDiscoveryFindingEnvelopeV1,
  sha256Text,
  type DiscoveryFindingEnvelopeV1,
  type DiscoveryFindingReadyV1,
} from '../../packages/contracts/src/index.js';
import {
  createSentenceEvidenceFixture,
  deterministicEvidenceLocator,
} from '../helpers/stage-12-evidence.js';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim()
  ? await requireTestDatabaseTarget()
  : undefined;
const pool: Pool | undefined = databaseUrl ? createPostgresPool(databaseUrl) : undefined;
const projectId = `akp-5-wp5-db-${randomUUID()}`;
const securityPrincipalId = randomUUID();
const productionClaimId = `claim-wp5-production-${randomUUID()}`;
const unrelatedClaimId = `claim-wp5-unrelated-${randomUUID()}`;
const productionClaimRevision1 = `revision-wp5-production-r1-${randomUUID()}`;
const productionClaimRevision2 = `revision-wp5-production-r2-${randomUUID()}`;
const unrelatedClaimRevision = `revision-wp5-unrelated-${randomUUID()}`;
const now = '2026-08-31T00:30:00.000Z';
const evidenceSourceText =
  'The durable Evidence record remains bound to its real SourceVersion authority.';
const evidenceExactText =
  'The durable Evidence record remains bound to its real SourceVersion authority.';

const resolveDatabaseSecurity = async ({
  projectId: requestedProjectId,
}: {
  projectId: string;
}) => {
  const result = await pool!.query<{
    readonly project_status: string;
    readonly project_active: boolean;
    readonly principal_status: string | null;
    readonly scopes: string[] | null;
    readonly sensitivity_clearance: 'public' | 'internal' | 'private' | 'restricted' | null;
  }>(
    `SELECT project.status AS project_status,
            project.active AS project_active,
            principal.status AS principal_status,
            membership.scopes,
            membership.sensitivity_clearance
     FROM project_admin.projects project
     LEFT JOIN auth.project_memberships membership
       ON membership.project_id = project.id
      AND membership.principal_id = $2
     LEFT JOIN auth.principals principal
       ON principal.principal_id = membership.principal_id
     WHERE project.id = $1`,
    [requestedProjectId, securityPrincipalId],
  );
  const row = result.rows[0];
  if (
    !row ||
    row.project_status !== 'ACTIVE' ||
    row.project_active !== true ||
    row.principal_status !== 'active' ||
    row.scopes === null ||
    row.sensitivity_clearance === null
  ) {
    return undefined;
  }
  return {
    projectId: requestedProjectId,
    accessScope: row.scopes,
    sensitivity: row.sensitivity_clearance,
  };
};

const seedRealEvidence = async (): Promise<{
  readonly evidenceId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly evidenceSpanId: string;
}> => {
  const originalAsset = await new PostgresOriginalAssetRepository(pool!).store({
    submissionId: `wp5-evidence-${randomUUID()}`,
    projectId,
    actorId: securityPrincipalId,
    channel: 'direct_text',
    materialKind: 'plain_text',
    mediaType: 'text/plain',
    contentHash: sha256Text(evidenceSourceText),
    sizeBytes: Buffer.byteLength(evidenceSourceText, 'utf8'),
    storageKey: `akp-5-wp5/${projectId}/${randomUUID()}`,
    accessScope: ['review'],
    sensitivity: 'internal',
    createdAt: now,
  });
  const fixture = createSentenceEvidenceFixture({
    revisionId: randomUUID(),
    projectId,
    sourceId: originalAsset.sourceId,
    sourceVersionId: originalAsset.sourceVersionId,
    sourceText: evidenceSourceText,
    evidenceExactText,
    accessScope: ['review'],
    sensitivity: 'internal',
    createdAt: now,
  });
  const saved = await new PostgresTransformationRepository(pool!).save({
    projectId,
    sourceId: originalAsset.sourceId,
    sourceVersionId: originalAsset.sourceVersionId,
    sourceContentHash: fixture.sourceContentHash,
    transformer: fixture.revision.transformer,
    output: {
      documentIR: fixture.revision.documentIR,
      sourceMap: fixture.revision.sourceMap,
      documentHash: fixture.revision.documentHash,
      sourceMapHash: fixture.revision.sourceMapHash,
    },
    accessScope: fixture.revision.accessScope,
    sensitivity: fixture.revision.sensitivity,
    createdAt: now,
  });
  const indexed = await new PostgresEvidenceRepository(pool!).index(
    buildEvidenceCandidates(saved.revision, deterministicEvidenceLocator),
  );
  const evidence = indexed.items.find(
    (item) => item.nodeKind === 'sentence' && item.pointer === '/blocks/0/sentences/0',
  );
  if (!evidence) throw new Error('The real PostgreSQL Evidence fixture was not indexed.');
  return {
    evidenceId: evidence.evidenceId,
    sourceId: evidence.sourceId,
    sourceVersionId: evidence.sourceVersionId,
    evidenceSpanId: evidence.evidenceId,
  };
};

const findingFor = (
  findingId: string,
  options: {
    readonly relatedResourceRefs?: readonly {
      readonly schemaVersion: '1.0.0';
      readonly resourceKind: 'CANONICAL_CLAIM';
      readonly resourceId: string;
      readonly projectId: string;
      readonly resourceState: 'CURRENT';
    }[];
    readonly evidenceIds?: readonly string[];
  } = {},
): DiscoveryFindingEnvelopeV1 =>
  createDiscoveryFindingEnvelopeV1({
    schemaVersion: '1.0.0',
    findingId,
    findingRevision: 1,
    projectId,
    findingType: 'KNOWLEDGE_GAP',
    generationMethod: 'DETERMINISTIC',
    lifecycleState: 'NEW',
    payload: {
      schemaVersion: '1.0.0',
      payloadType: 'KNOWLEDGE_GAP',
      gapKind: 'MISSING_FACT',
      subject: `subject-${findingId}`,
      missingFact: 'database fact',
      question: 'Which current authority is valid?',
    },
    relatedResourceRefs: options.relatedResourceRefs ?? [],
    evidenceIds: options.evidenceIds ?? [],
    sourceProjectionDigest: 'sha256:wp5-db-source',
    canonicalBase: {
      schemaVersion: '1.0.0',
      canonicalVersion: 9,
      snapshotDigest: 'sha256:wp5-db-canonical',
    },
    discoveryBase: {
      schemaVersion: '1.0.0',
      projectionRevision: 'projection-wp5-db-9',
      projectionDigest: 'sha256:wp5-db-discovery',
    },
    runId: `run-${findingId}`,
    signalSummary: {},
    rationale: 'The finding must be revalidated against current authorities.',
    derivationSummary: 'AKP-5 WP5 PostgreSQL fixture.',
    provenance: {
      schemaVersion: '1.0.0',
      kind: 'DETERMINISTIC',
      ruleId: 'wp5-db-rule',
      ruleVersion: '1',
      inputDigest: 'sha256:wp5-db-input',
    },
    accessScope: ['review'],
    sensitivity: 'internal',
    fingerprint: `sha256:${findingId}-fingerprint`,
    fingerprintVersion: 'discovery-fingerprint:v1',
    retentionClass: 'DURABLE_DERIVED_RECORD',
    createdAt: now,
  });

const publicationFor = (finding: DiscoveryFindingEnvelopeV1): DiscoveryFindingReadyV1 => ({
  schemaVersion: '1.0.0',
  publicationId: `publication-${finding.findingId}`,
  projectId,
  findingId: finding.findingId,
  findingRevision: finding.findingRevision,
  fingerprint: finding.fingerprint,
  fingerprintVersion: finding.fingerprintVersion,
  jobId: `job-${finding.findingId}`,
  runId: finding.runId,
  attemptId: `attempt-${finding.findingId}`,
  canonicalBase: finding.canonicalBase,
  requiredDiscoveryBase: finding.discoveryBase,
  occurredAt: now,
});

const seedCanonicalClaimHistory = async (
  options: {
    readonly changedRelevantClaim?: boolean;
    readonly laterUnrelatedClaim?: boolean;
    readonly sensitivity?: 'public' | 'internal' | 'private' | 'restricted';
    readonly accessScope?: readonly string[];
  } = {},
): Promise<void> => {
  const client = await pool!.connect();
  const accessScope = options.accessScope ?? ['review'];
  const sensitivity = options.sensitivity ?? 'internal';
  try {
    const baseCommitId = randomUUID();
    const baseManifestId = randomUUID();
    await client.query(
      `INSERT INTO canonical.commits (
         commit_id, project_id, manifest_id, manifest_digest, change_set_id,
         result_json, committed_at
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [
        baseCommitId,
        projectId,
        baseManifestId,
        `sha256:${'a'.repeat(64)}`,
        randomUUID(),
        JSON.stringify({ afterVersion: 9, snapshotDigest: 'sha256:wp5-db-canonical' }),
        now,
      ],
    );
    await client.query(
      `INSERT INTO canonical.claims (
         claim_id, project_id, source_version_id, manifest_id, claim_json, created_at
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [
        productionClaimId,
        projectId,
        randomUUID(),
        baseManifestId,
        JSON.stringify({
          claimId: productionClaimId,
          projectId,
          revisionNumber: 1,
          claimText: 'The production-shaped Finding relies on this claim.',
          sourceVersionId: 'wp5-production-source-version',
          evidenceIds: [],
          createdFromManifestId: baseManifestId,
          authorityId: null,
          authorityDigest: null,
          accessScope,
          sensitivity,
          createdAt: now,
        }),
        now,
      ],
    );
    await client.query(
      `INSERT INTO canonical.revisions (
         revision_id, project_id, commit_id, revision_json, created_at
       ) VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [
        productionClaimRevision1,
        projectId,
        baseCommitId,
        JSON.stringify({
          revisionId: productionClaimRevision1,
          projectId,
          commitId: baseCommitId,
          manifestId: baseManifestId,
          operation: 'ADD_CLAIM',
          beforeVersion: 8,
          afterVersion: 9,
          claimId: productionClaimId,
          reason: 'WP5 production CURRENT fixture',
          createdAt: now,
        }),
        now,
      ],
    );
    if (!options.changedRelevantClaim && !options.laterUnrelatedClaim) return;

    const laterCommitId = randomUUID();
    const laterManifestId = randomUUID();
    await client.query(
      `INSERT INTO canonical.commits (
         commit_id, project_id, manifest_id, manifest_digest, change_set_id,
         result_json, committed_at
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [
        laterCommitId,
        projectId,
        laterManifestId,
        `sha256:${'b'.repeat(64)}`,
        randomUUID(),
        JSON.stringify({ afterVersion: 10, snapshotDigest: 'sha256:wp5-db-canonical-v2' }),
        now,
      ],
    );
    if (options.changedRelevantClaim) {
      await client.query(
        `INSERT INTO canonical.revisions (
           revision_id, project_id, commit_id, revision_json, created_at
         ) VALUES ($1, $2, $3, $4::jsonb, $5)`,
        [
          productionClaimRevision2,
          projectId,
          laterCommitId,
          JSON.stringify({
            revisionId: productionClaimRevision2,
            projectId,
            commitId: laterCommitId,
            manifestId: laterManifestId,
            operation: 'UPDATE_CLAIM',
            beforeVersion: 9,
            afterVersion: 10,
            claimId: productionClaimId,
            reason: 'WP5 relevant claim changed',
            createdAt: now,
          }),
          now,
        ],
      );
    }
    if (options.laterUnrelatedClaim) {
      await client.query(
        `INSERT INTO canonical.claims (
           claim_id, project_id, source_version_id, manifest_id, claim_json, created_at
         ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
        [
          unrelatedClaimId,
          projectId,
          randomUUID(),
          laterManifestId,
          JSON.stringify({
            claimId: unrelatedClaimId,
            projectId,
            revisionNumber: 1,
            claimText: 'This later claim is unrelated to the Finding.',
            sourceVersionId: 'wp5-unrelated-source-version',
            evidenceIds: [],
            createdFromManifestId: laterManifestId,
            authorityId: null,
            authorityDigest: null,
            accessScope: ['review'],
            sensitivity: 'internal',
            createdAt: now,
          }),
          now,
        ],
      );
      await client.query(
        `INSERT INTO canonical.revisions (
           revision_id, project_id, commit_id, revision_json, created_at
         ) VALUES ($1, $2, $3, $4::jsonb, $5)`,
        [
          unrelatedClaimRevision,
          projectId,
          laterCommitId,
          JSON.stringify({
            revisionId: unrelatedClaimRevision,
            projectId,
            commitId: laterCommitId,
            manifestId: laterManifestId,
            operation: 'ADD_CLAIM',
            beforeVersion: 9,
            afterVersion: 10,
            claimId: unrelatedClaimId,
            reason: 'WP5 unrelated claim fixture',
            createdAt: now,
          }),
          now,
        ],
      );
    }
  } finally {
    client.release();
  }
};

const cleanup = async (): Promise<void> => {
  if (pool === undefined) return;
  const client = await pool.connect();
  try {
    await client.query('SET session_replication_role = replica');
    await client.query('DELETE FROM evidence.spans WHERE project_id = $1', [projectId]);
    await client.query('DELETE FROM transformation.attempts WHERE project_id = $1', [projectId]);
    await client.query('DELETE FROM transformation.revisions WHERE project_id = $1', [projectId]);
    await client.query('DELETE FROM discovery.reentry_review_resources WHERE project_id = $1', [
      projectId,
    ]);
    await client.query('DELETE FROM discovery.reentry_review_roots WHERE project_id = $1', [
      projectId,
    ]);
    await client.query('DELETE FROM discovery.reentry_consumption WHERE project_id = $1', [
      projectId,
    ]);
    await client.query('DELETE FROM discovery.reentry_candidates WHERE project_id = $1', [
      projectId,
    ]);
    await client.query('DELETE FROM discovery.reentry_manifests WHERE project_id = $1', [
      projectId,
    ]);
    await client.query('DELETE FROM discovery.finding_lifecycle_history WHERE project_id = $1', [
      projectId,
    ]);
    await client.query('DELETE FROM discovery.finding_lifecycle_current WHERE project_id = $1', [
      projectId,
    ]);
    await client.query('DELETE FROM discovery.findings WHERE project_id = $1', [projectId]);
    await client.query('DELETE FROM canonical.revisions WHERE project_id = $1', [projectId]);
    await client.query('DELETE FROM canonical.commits WHERE project_id = $1', [projectId]);
    await client.query('DELETE FROM canonical.claims WHERE project_id = $1', [projectId]);
    await client.query('DELETE FROM canonical.project_state WHERE project_id = $1', [projectId]);
    await client.query('DELETE FROM settings.policy_context_revisions WHERE project_id = $1', [
      projectId,
    ]);
    await client.query('DELETE FROM settings.settings_revisions WHERE project_id = $1', [
      projectId,
    ]);
    await client.query('DELETE FROM asset.storage_receipts WHERE project_id = $1', [projectId]);
    await client.query(
      `DELETE FROM asset.source_versions
       WHERE source_id IN (SELECT source_id FROM asset.sources WHERE project_id = $1)`,
      [projectId],
    );
    await client.query('DELETE FROM asset.sources WHERE project_id = $1', [projectId]);
    await client.query('DELETE FROM asset.original_assets WHERE storage_key LIKE $1', [
      `akp-5-wp5/${projectId}/%`,
    ]);
    await client.query('DELETE FROM auth.project_memberships WHERE project_id = $1', [projectId]);
    await client.query('DELETE FROM auth.principals WHERE principal_id = $1', [
      securityPrincipalId,
    ]);
    await client.query('DELETE FROM project_admin.projects WHERE id = $1', [projectId]);
  } finally {
    await client.query('SET session_replication_role = origin');
    client.release();
  }
};

const setupFinding = async (
  finding: DiscoveryFindingEnvelopeV1,
): Promise<PostgresDiscoveryFindingRepository> => {
  const repository = new PostgresDiscoveryFindingRepository(pool!);
  await repository.save(finding);
  return repository;
};

const evaluator = (): DiscoveryReentryFreshnessEvaluator =>
  new DiscoveryReentryFreshnessEvaluator(
    new PostgresDiscoveryReentryFreshnessAuthority(pool!, {
      resolveSecurity: resolveDatabaseSecurity,
    }),
  );

const authority = (): PostgresDiscoveryReentryFreshnessAuthority =>
  new PostgresDiscoveryReentryFreshnessAuthority(pool!, {
    resolveSecurity: resolveDatabaseSecurity,
  });

describe.runIf(databaseUrl)('AKP-5 WP5 PostgreSQL freshness authority and guards', () => {
  beforeAll(async () => {
    await migrateUpTo(undefined, databaseUrl!);
  });

  beforeEach(async () => {
    await cleanup();
    await pool!.query(
      `INSERT INTO project_admin.projects (id, name, status, active)
       VALUES ($1, 'AKP-5 WP5 database project', 'ACTIVE', true)`,
      [projectId],
    );
    await pool!.query(
      `INSERT INTO auth.principals (principal_id, actor_type, status, created_at)
       VALUES ($1, 'user', 'active', $2)`,
      [securityPrincipalId, now],
    );
    await pool!.query(
      `INSERT INTO auth.project_memberships
         (principal_id, project_id, scopes, sensitivity_clearance, is_owner)
       VALUES ($1, $2, $3, $4, false)`,
      [securityPrincipalId, projectId, ['review'], 'internal'],
    );
    await pool!.query(
      `INSERT INTO settings.policy_context_revisions
         (project_id, revision, policy_binding, created_at)
       VALUES ($1, 1, '{}'::jsonb, $2)`,
      [projectId, now],
    );
  });

  afterAll(async () => {
    await cleanup();
    await pool!.end();
  });

  it('A/B: reads server-owned lifecycle and keeps a fresh Finding eligible', async () => {
    const finding = findingFor('finding-a');
    await setupFinding(finding);
    const currentAuthority = authority();
    const state = await currentAuthority.read({
      binding: discoveryReentryFreshnessBindingFromFindingV1(finding),
      stage: 'REENTRY_INTAKE',
    });
    expect(state.lifecycleState).toBe('NEW');
    expect(state.authorization).toBe('AUTHORIZED');
    const repository = new PostgresDiscoveryReentryRepository(pool!, {
      lifecycleRepository: new PostgresDiscoveryFindingRepository(pool!),
    });
    const result = await new DiscoveryReentryConsumer(
      repository,
      { resolve: async () => ({ status: 'RESOLVED' as const, refs: [] }) },
      () => new Date(now),
      { freshnessEvaluator: evaluator() },
    ).consume(publicationFor(finding));
    expect(result.status).toBe('CREATED');
  });

  it('A: resolves an unversioned production CURRENT ref at frozen R1 before blocking R2', async () => {
    await seedCanonicalClaimHistory({ changedRelevantClaim: true });
    const relatedResource = {
      schemaVersion: '1.0.0' as const,
      resourceKind: 'CANONICAL_CLAIM' as const,
      resourceId: productionClaimId,
      projectId,
      resourceState: 'CURRENT' as const,
    };
    const finding = findingFor('finding-production-current-r1', {
      relatedResourceRefs: [relatedResource],
    });
    const findingRepository = await setupFinding(finding);
    const resolver = new PostgresDiscoveryApprovedResourceRevisionResolver(pool!);
    await expect(
      resolver.resolve({
        projectId,
        finding,
        canonicalBase: finding.canonicalBase,
        discoveryBase: finding.discoveryBase,
        relatedResourceRefs: finding.relatedResourceRefs,
      }),
    ).resolves.toMatchObject({
      status: 'RESOLVED',
      refs: [{ resourceRevision: productionClaimRevision1 }],
    });

    const result = await new DiscoveryReentryConsumer(
      new PostgresDiscoveryReentryRepository(pool!, {
        lifecycleRepository: findingRepository,
      }),
      resolver,
      () => new Date(now),
      { freshnessEvaluator: evaluator() },
    ).consume(publicationFor(finding));

    expect(result).toMatchObject({
      status: 'INELIGIBLE',
      lifecycleState: 'STALE',
      freshnessAssessment: {
        state: 'REVALIDATION_REQUIRED',
        reasonCodes: ['RELATED_RESOURCE_CHANGED'],
      },
    });
    await expect(
      pool!.query<{ count: number }>(
        `SELECT count(*)::int AS count
         FROM discovery.reentry_manifests
         WHERE project_id = $1 AND finding_id = $2`,
        [projectId, finding.findingId],
      ),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
    await expect(
      findingRepository.findLifecycle({
        projectId,
        findingId: finding.findingId,
        findingRevision: finding.findingRevision,
      }),
    ).resolves.toMatchObject({ lifecycleState: 'STALE' });
  });

  it('A: keeps a later unrelated Canonical commit fresh for the relied-on R1', async () => {
    await seedCanonicalClaimHistory({ laterUnrelatedClaim: true });
    const relatedResource = {
      schemaVersion: '1.0.0' as const,
      resourceKind: 'CANONICAL_CLAIM' as const,
      resourceId: productionClaimId,
      projectId,
      resourceState: 'CURRENT' as const,
    };
    const finding = findingFor('finding-production-unrelated-canonical', {
      relatedResourceRefs: [relatedResource],
    });
    const findingRepository = await setupFinding(finding);
    const result = await new DiscoveryReentryConsumer(
      new PostgresDiscoveryReentryRepository(pool!, {
        lifecycleRepository: findingRepository,
      }),
      new PostgresDiscoveryApprovedResourceRevisionResolver(pool!),
      () => new Date(now),
      { freshnessEvaluator: evaluator() },
    ).consume(publicationFor(finding));

    expect(result).toMatchObject({ status: 'CREATED' });
    if (result.status !== 'CREATED') return;
    expect(result.candidate.relatedResourceRefs).toMatchObject([
      { resourceId: productionClaimId, resourceRevision: productionClaimRevision1 },
    ]);
  });

  it('security: denies no-resource intake without transitioning a valid Finding to STALE', async () => {
    await pool!.query('DELETE FROM auth.project_memberships WHERE project_id = $1', [projectId]);
    const finding = findingFor('finding-security-denied');
    const findingRepository = await setupFinding(finding);
    const result = await new DiscoveryReentryConsumer(
      new PostgresDiscoveryReentryRepository(pool!, {
        lifecycleRepository: findingRepository,
      }),
      new PostgresDiscoveryApprovedResourceRevisionResolver(pool!),
      () => new Date(now),
      { freshnessEvaluator: evaluator() },
    ).consume(publicationFor(finding));

    expect(result).toMatchObject({
      status: 'INELIGIBLE',
      lifecycleState: 'NEW',
      freshnessAssessment: {
        state: 'AUTHORIZATION_DENIED',
        reasonCodes: ['ACCESS_NO_LONGER_AUTHORIZED'],
      },
    });
    await expect(
      findingRepository.findLifecycle({
        projectId,
        findingId: finding.findingId,
        findingRevision: finding.findingRevision,
      }),
    ).resolves.toMatchObject({ lifecycleState: 'NEW' });
  });

  it('security: denies a Finding when the authoritative membership is missing', async () => {
    await pool!.query('DELETE FROM auth.project_memberships WHERE project_id = $1', [projectId]);
    const finding = findingFor('finding-security-missing-membership');
    const findingRepository = await setupFinding(finding);
    const result = await new DiscoveryReentryConsumer(
      new PostgresDiscoveryReentryRepository(pool!, {
        lifecycleRepository: findingRepository,
      }),
      new PostgresDiscoveryApprovedResourceRevisionResolver(pool!),
      () => new Date(now),
      { freshnessEvaluator: evaluator() },
    ).consume(publicationFor(finding));

    expect(result).toMatchObject({
      status: 'INELIGIBLE',
      lifecycleState: 'NEW',
      freshnessAssessment: {
        state: 'AUTHORIZATION_DENIED',
        reasonCodes: ['ACCESS_NO_LONGER_AUTHORIZED'],
      },
    });
    await expect(
      findingRepository.findLifecycle({
        projectId,
        findingId: finding.findingId,
        findingRevision: finding.findingRevision,
      }),
    ).resolves.toMatchObject({ lifecycleState: 'NEW' });
  });

  it('security: denies a Finding when the project is inactive', async () => {
    await pool!.query('UPDATE project_admin.projects SET active = false WHERE id = $1', [
      projectId,
    ]);
    const finding = findingFor('finding-security-inactive-project');
    const findingRepository = await setupFinding(finding);
    const result = await new DiscoveryReentryConsumer(
      new PostgresDiscoveryReentryRepository(pool!, {
        lifecycleRepository: findingRepository,
      }),
      new PostgresDiscoveryApprovedResourceRevisionResolver(pool!),
      () => new Date(now),
      { freshnessEvaluator: evaluator() },
    ).consume(publicationFor(finding));

    expect(result).toMatchObject({
      status: 'INELIGIBLE',
      lifecycleState: 'NEW',
      freshnessAssessment: {
        state: 'AUTHORIZATION_DENIED',
        reasonCodes: ['ACCESS_NO_LONGER_AUTHORIZED'],
      },
    });
    await expect(
      findingRepository.findLifecycle({
        projectId,
        findingId: finding.findingId,
        findingRevision: finding.findingRevision,
      }),
    ).resolves.toMatchObject({ lifecycleState: 'NEW' });
  });

  it('security: blocks a sensitivity-strengthened relied-on claim without creating intake', async () => {
    await seedCanonicalClaimHistory({ sensitivity: 'restricted' });
    const relatedResource = {
      schemaVersion: '1.0.0' as const,
      resourceKind: 'CANONICAL_CLAIM' as const,
      resourceId: productionClaimId,
      projectId,
      resourceState: 'CURRENT' as const,
    };
    const finding = findingFor('finding-security-sensitivity', {
      relatedResourceRefs: [relatedResource],
    });
    const findingRepository = await setupFinding(finding);
    const result = await new DiscoveryReentryConsumer(
      new PostgresDiscoveryReentryRepository(pool!, {
        lifecycleRepository: findingRepository,
      }),
      new PostgresDiscoveryApprovedResourceRevisionResolver(pool!),
      () => new Date(now),
      { freshnessEvaluator: evaluator() },
    ).consume(publicationFor(finding));

    expect(result).toMatchObject({
      status: 'INELIGIBLE',
      lifecycleState: 'NEW',
      freshnessAssessment: {
        state: 'AUTHORIZATION_DENIED',
        reasonCodes: ['SENSITIVITY_POLICY_CHANGED'],
      },
    });
  });

  it('security: denies a scope-narrowed membership without creating intake or becoming STALE', async () => {
    await pool!.query(
      `UPDATE auth.project_memberships
       SET scopes = ARRAY['different-scope']
       WHERE principal_id = $1 AND project_id = $2`,
      [securityPrincipalId, projectId],
    );
    const finding = findingFor('finding-security-scope-narrowed');
    const findingRepository = await setupFinding(finding);
    const result = await new DiscoveryReentryConsumer(
      new PostgresDiscoveryReentryRepository(pool!, {
        lifecycleRepository: findingRepository,
      }),
      new PostgresDiscoveryApprovedResourceRevisionResolver(pool!),
      () => new Date(now),
      { freshnessEvaluator: evaluator() },
    ).consume(publicationFor(finding));

    expect(result).toMatchObject({
      status: 'INELIGIBLE',
      lifecycleState: 'NEW',
      freshnessAssessment: {
        state: 'AUTHORIZATION_DENIED',
        reasonCodes: ['ACCESS_NO_LONGER_AUTHORIZED'],
      },
    });
  });

  it('security: denies a strengthened membership sensitivity without exposing a candidate', async () => {
    await pool!.query(
      `UPDATE auth.project_memberships
       SET sensitivity_clearance = 'restricted'
       WHERE principal_id = $1 AND project_id = $2`,
      [securityPrincipalId, projectId],
    );
    const finding = findingFor('finding-security-membership-sensitivity');
    const findingRepository = await setupFinding(finding);
    const result = await new DiscoveryReentryConsumer(
      new PostgresDiscoveryReentryRepository(pool!, {
        lifecycleRepository: findingRepository,
      }),
      new PostgresDiscoveryApprovedResourceRevisionResolver(pool!),
      () => new Date(now),
      { freshnessEvaluator: evaluator() },
    ).consume(publicationFor(finding));

    expect(result).toMatchObject({
      status: 'INELIGIBLE',
      lifecycleState: 'NEW',
      freshnessAssessment: {
        state: 'AUTHORIZATION_DENIED',
        reasonCodes: ['SENSITIVITY_POLICY_CHANGED'],
      },
    });
  });

  it('C: blocks intake when an approved related resource is unavailable', async () => {
    const relatedResource = {
      schemaVersion: '1.0.0' as const,
      resourceKind: 'CANONICAL_CLAIM' as const,
      resourceId: 'missing-claim',
      projectId,
      resourceState: 'CURRENT' as const,
    };
    const finding = findingFor('finding-c', { relatedResourceRefs: [relatedResource] });
    const findingRepository = await setupFinding(finding);
    let resolverCalls = 0;
    const result = await new DiscoveryReentryConsumer(
      new PostgresDiscoveryReentryRepository(pool!, { lifecycleRepository: findingRepository }),
      {
        resolve: async () => {
          resolverCalls += 1;
          return {
            status: 'RESOLVED' as const,
            refs: [
              { ...relatedResource, resourceState: 'APPROVED' as const, resourceRevision: '1' },
            ],
          };
        },
      },
      () => new Date(now),
      { freshnessEvaluator: evaluator() },
    ).consume(publicationFor(finding));
    expect(result).toMatchObject({ status: 'INELIGIBLE', lifecycleState: 'STALE' });
    expect(resolverCalls).toBe(1);
    await expect(
      new PostgresDiscoveryReentryRepository(pool!, {
        lifecycleRepository: findingRepository,
      }).findExisting('not-created'),
    ).resolves.toBeUndefined();
  });

  it('D/E: blocks intake when Evidence is unavailable and preserves project isolation', async () => {
    const finding = findingFor('finding-d', { evidenceIds: ['missing-evidence'] });
    await setupFinding(finding);
    const result = await new DiscoveryReentryConsumer(
      new PostgresDiscoveryReentryRepository(pool!, {
        lifecycleRepository: new PostgresDiscoveryFindingRepository(pool!),
      }),
      { resolve: async () => ({ status: 'RESOLVED' as const, refs: [] }) },
      () => new Date(now),
      { freshnessEvaluator: evaluator() },
    ).consume(publicationFor(finding));
    expect(result).toMatchObject({ status: 'INELIGIBLE', lifecycleState: 'STALE' });
    const currentAuthority = authority();
    const isolated = await currentAuthority.read({
      binding: {
        ...discoveryReentryFreshnessBindingFromFindingV1(finding),
        approvedRelatedResourceRefs: [
          {
            schemaVersion: '1.0.0',
            resourceKind: 'CANONICAL_CLAIM',
            resourceId: 'cross-project-claim',
            projectId: 'another-project',
            resourceState: 'APPROVED',
            resourceRevision: '1',
          },
        ],
      },
      stage: 'REENTRY_INTAKE',
    });
    expect(isolated.relatedResources[0]).toMatchObject({
      availability: 'UNAVAILABLE',
      projectId: 'another-project',
    });
  });

  it('B/C: materializes real Evidence lineage and rechecks the same lineage as FRESH', async () => {
    const realEvidence = await seedRealEvidence();
    const finding = findingFor('finding-real-evidence-lineage', {
      evidenceIds: [realEvidence.evidenceId],
    });
    const findingRepository = await setupFinding(finding);
    const reentryRepository = new PostgresDiscoveryReentryRepository(pool!, {
      lifecycleRepository: findingRepository,
    });
    const consumed = await new DiscoveryReentryConsumer(
      reentryRepository,
      { resolve: async () => ({ status: 'RESOLVED' as const, refs: [] }) },
      () => new Date(now),
      { freshnessEvaluator: evaluator() },
    ).consume(publicationFor(finding));
    expect(consumed.status).toBe('CREATED');
    if (consumed.status !== 'CREATED') return;

    const materialized = await new DiscoveryReviewMaterializer(
      reentryRepository,
      new PostgresDiscoveryReviewResourceRepository(pool!),
      evaluator(),
      authority(),
    ).materialize({ logicalIdentityKey: consumed.logicalIdentityKey });
    expect(materialized.status).toBe('CREATED');
    if (materialized.status !== 'CREATED') return;
    expect(materialized.resource.evidenceLineage).toEqual([
      {
        schemaVersion: '1.0.0',
        evidenceId: realEvidence.evidenceId,
        sourceId: realEvidence.sourceId,
        sourceVersionId: realEvidence.sourceVersionId,
        evidenceSpanId: realEvidence.evidenceSpanId,
      },
    ]);
    await expect(
      evaluator().assess({
        binding: discoveryReentryFreshnessBindingFromReviewResourceV1(materialized.resource),
        stage: 'REVIEW_CONTEXT_MATERIALIZATION',
        assessedAt: now,
      }),
    ).resolves.toMatchObject({ state: 'FRESH', reasonCodes: [] });
  });

  it('F: does not save a Review resource when Guard B sees terminal lifecycle', async () => {
    const finding = findingFor('finding-f');
    const findingRepository = await setupFinding(finding);
    const reentryRepository = new PostgresDiscoveryReentryRepository(pool!, {
      lifecycleRepository: findingRepository,
    });
    const consumed = await new DiscoveryReentryConsumer(
      reentryRepository,
      { resolve: async () => ({ status: 'RESOLVED' as const, refs: [] }) },
      () => new Date(now),
      { freshnessEvaluator: evaluator() },
    ).consume(publicationFor(finding));
    expect(consumed.status).toBe('CREATED');
    if (consumed.status !== 'CREATED') return;
    const lifecycle = await findingRepository.findLifecycle({
      projectId,
      findingId: finding.findingId,
      findingRevision: finding.findingRevision,
    });
    await findingRepository.transitionLifecycle({
      projectId,
      findingId: finding.findingId,
      findingRevision: finding.findingRevision,
      expectedLifecycleRevision: lifecycle!.lifecycleRevision,
      targetState: 'STALE',
      cause: 'SYSTEM_RECONCILIATION',
      reasonCode: 'RELEVANT_INPUT_CHANGED',
      occurredAt: now,
      context: { canonicalBase: finding.canonicalBase, discoveryBase: finding.discoveryBase },
    });
    let writes = 0;
    await expect(
      new DiscoveryReviewMaterializer(
        reentryRepository,
        {
          save: async () => {
            writes += 1;
            return 'CREATED';
          },
        },
        evaluator(),
      ).materialize({ logicalIdentityKey: consumed.logicalIdentityKey }),
    ).rejects.toThrow(/not eligible/);
    expect(writes).toBe(0);
    await expect(
      createPostgresReviewDiscoveryCandidateReader(pool!).list(projectId),
    ).resolves.toEqual([]);
  });

  it('G/H: retains but hides an immutable resource when authority changes after save', async () => {
    const finding = findingFor('finding-gh');
    const findingRepository = await setupFinding(finding);
    const reentryRepository = new PostgresDiscoveryReentryRepository(pool!, {
      lifecycleRepository: findingRepository,
    });
    const consumed = await new DiscoveryReentryConsumer(
      reentryRepository,
      { resolve: async () => ({ status: 'RESOLVED' as const, refs: [] }) },
      () => new Date(now),
      { freshnessEvaluator: evaluator() },
    ).consume(publicationFor(finding));
    expect(consumed.status).toBe('CREATED');
    if (consumed.status !== 'CREATED') return;
    const writer: DiscoveryReviewResourceWriterPort = {
      save: async (resource) => {
        const lifecycle = await findingRepository.findLifecycle({
          projectId,
          findingId: finding.findingId,
          findingRevision: finding.findingRevision,
        });
        await findingRepository.transitionLifecycle({
          projectId,
          findingId: finding.findingId,
          findingRevision: finding.findingRevision,
          expectedLifecycleRevision: lifecycle!.lifecycleRevision,
          targetState: 'STALE',
          cause: 'SYSTEM_RECONCILIATION',
          reasonCode: 'RELEVANT_INPUT_CHANGED',
          occurredAt: now,
          context: { canonicalBase: finding.canonicalBase, discoveryBase: finding.discoveryBase },
        });
        await new PostgresDiscoveryReviewResourceRepository(pool!).save(resource);
        return 'CREATED';
      },
    };
    const result = await new DiscoveryReviewMaterializer(
      reentryRepository,
      writer,
      evaluator(),
    ).materialize({ logicalIdentityKey: consumed.logicalIdentityKey });
    expect(result.status).toBe('BLOCKED');
    if (result.status !== 'BLOCKED') return;
    expect(result.resource).toBeDefined();
    expect(
      (
        await pool!.query<{ count: number }>(
          `SELECT count(*)::int AS count
           FROM discovery.reentry_review_resources
           WHERE project_id = $1`,
          [projectId],
        )
      ).rows[0]?.count,
    ).toBe(1);
    await expect(
      createPostgresReviewDiscoveryCandidateReader(pool!).list(projectId),
    ).resolves.toEqual([]);
  });

  it('I/J/K: terminal replay is closed, migration is absent, and the legacy schemas remain present', async () => {
    const finding = findingFor('finding-ijk');
    const findingRepository = await setupFinding(finding);
    const lifecycle = await findingRepository.findLifecycle({
      projectId,
      findingId: finding.findingId,
      findingRevision: finding.findingRevision,
    });
    await findingRepository.transitionLifecycle({
      projectId,
      findingId: finding.findingId,
      findingRevision: finding.findingRevision,
      expectedLifecycleRevision: lifecycle!.lifecycleRevision,
      targetState: 'RESOLVED',
      cause: 'SYSTEM_RECONCILIATION',
      reasonCode: 'CANONICAL_EQUIVALENT_ACCEPTED',
      occurredAt: now,
      context: { canonicalBase: finding.canonicalBase, discoveryBase: finding.discoveryBase },
    });
    const result = await new DiscoveryReentryConsumer(
      new PostgresDiscoveryReentryRepository(pool!, { lifecycleRepository: findingRepository }),
      { resolve: async () => ({ status: 'RESOLVED' as const, refs: [] }) },
      () => new Date(now),
      { freshnessEvaluator: evaluator() },
    ).consume(publicationFor(finding));
    expect(result).toMatchObject({ status: 'INELIGIBLE', lifecycleState: 'RESOLVED' });
    expect(existsSync('db/migrations/055_akp_5_wp5.sql')).toBe(false);
    expect(existsSync('db/migrations/053_akp_5_wp2_discovery_reentry.sql')).toBe(true);
    expect(existsSync('db/migrations/054_akp_5_wp3_persistent_review_bridge.sql')).toBe(true);
  });
});
