import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { PostgresDiscoveryFindingRepository } from '../../adapters/discovery-finding-postgres/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import type {
  DiscoveryFindingEnvelopeInputV1,
  DiscoveryFindingPayloadV1,
  DiscoveryFindingProvenanceV1,
  DiscoveryFindingType,
  DiscoveryResourceRefV1,
} from '../../packages/contracts/src/index.js';
import {
  createDiscoveryFindingEnvelopeV1,
  normalizeDiscoveryFingerprintInputV1,
} from '../../packages/contracts/src/index.js';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim()
  ? await requireTestDatabaseTarget()
  : undefined;
const projectIds = new Set<string>();

const projectId = (label: string): string => {
  const value = `akp-2-wp2-${label}-${randomUUID()}`;
  projectIds.add(value);
  return value;
};

const ref = (
  project: string,
  resourceId: string,
  resourceKind: DiscoveryResourceRefV1['resourceKind'] = 'CANONICAL_CLAIM',
): DiscoveryResourceRefV1 => ({
  schemaVersion: '1.0.0',
  resourceKind,
  resourceId,
  projectId: project,
  resourceState: 'CURRENT',
});

const deterministic: DiscoveryFindingProvenanceV1 = {
  schemaVersion: '1.0.0',
  kind: 'DETERMINISTIC',
  ruleId: 'discovery.wp2.test',
  ruleVersion: '1',
  inputDigest: 'sha256:wp2-input',
};

const makeFinding = (input: {
  readonly projectId: string;
  readonly findingId: string;
  readonly findingType: DiscoveryFindingType;
  readonly payload: DiscoveryFindingPayloadV1;
  readonly relatedResourceRefs: readonly DiscoveryResourceRefV1[];
  readonly findingRevision?: number;
  readonly generationMethod?: DiscoveryFindingEnvelopeInputV1['generationMethod'];
  readonly provenance?: DiscoveryFindingProvenanceV1;
  readonly accessScope?: readonly string[];
  readonly sensitivity?: DiscoveryFindingEnvelopeInputV1['sensitivity'];
}): ReturnType<typeof createDiscoveryFindingEnvelopeV1> =>
  createDiscoveryFindingEnvelopeV1({
    schemaVersion: '1.0.0',
    findingId: input.findingId,
    findingRevision: input.findingRevision ?? 1,
    projectId: input.projectId,
    findingType: input.findingType,
    generationMethod: input.generationMethod ?? 'DETERMINISTIC',
    lifecycleState: 'NEW',
    payload: input.payload,
    relatedResourceRefs: input.relatedResourceRefs,
    evidenceIds: ['evidence-wp2-1'],
    sourceProjectionDigest: 'sha256:source-projection',
    canonicalBase: {
      schemaVersion: '1.0.0',
      canonicalVersion: 7,
      snapshotDigest: 'sha256:canonical-snapshot',
    },
    discoveryBase: {
      schemaVersion: '1.0.0',
      projectionRevision: 'discovery-revision-7',
      projectionDigest: 'sha256:discovery-projection',
    },
    runId: 'run-wp2-1',
    signalSummary: { semanticSimilarity: 0.8, novelty: 0.2 },
    rationale: 'The bounded discovery signal is retained for review.',
    derivationSummary: 'Derived from a pinned project projection and evidence.',
    provenance: input.provenance ?? deterministic,
    accessScope: input.accessScope ?? ['owner', 'reviewer'],
    sensitivity: input.sensitivity ?? 'private',
    fingerprint: 'sha256:finding-fingerprint',
    fingerprintVersion: 'discovery-fingerprint-v1',
    retentionClass: 'DURABLE_DERIVED_RECORD',
    createdAt: '2026-08-29T00:00:00.000Z',
  } as DiscoveryFindingEnvelopeInputV1);

const payloadEntries = (
  project: string,
): readonly {
  readonly findingType: DiscoveryFindingType;
  readonly payload: DiscoveryFindingPayloadV1;
  readonly relatedResourceRefs: readonly DiscoveryResourceRefV1[];
}[] => {
  const claimA = ref(project, 'claim-a');
  const claimB = ref(project, 'claim-b');
  const conflict = ref(project, 'conflict-1', 'CANONICAL_CONFLICT');
  return [
    {
      findingType: 'KNOWLEDGE_GAP',
      payload: {
        schemaVersion: '1.0.0',
        payloadType: 'KNOWLEDGE_GAP',
        gapKind: 'MISSING_FACT',
        subject: 'Milo',
        missingFact: 'current weight',
        question: "What is Milo's current weight?",
      },
      relatedResourceRefs: [],
    },
    {
      findingType: 'EVIDENCE_GAP',
      payload: {
        schemaVersion: '1.0.0',
        payloadType: 'EVIDENCE_GAP',
        coverageKind: 'INSUFFICIENT',
        affectedResourceRef: claimA,
        coverageGap: 'The current claim has weak supporting evidence.',
        requiredEvidence: 'A current first-party source is required.',
      },
      relatedResourceRefs: [claimA],
    },
    {
      findingType: 'RELATION_HYPOTHESIS',
      payload: {
        schemaVersion: '1.0.0',
        payloadType: 'RELATION_HYPOTHESIS',
        sourceEndpoint: claimA,
        targetEndpoint: claimB,
        proposedRelationType: 'DEPENDS_ON',
        direction: 'DIRECTED',
      },
      relatedResourceRefs: [claimA, claimB],
    },
    {
      findingType: 'PATTERN_HYPOTHESIS',
      payload: {
        schemaVersion: '1.0.0',
        payloadType: 'PATTERN_HYPOTHESIS',
        patternKind: 'CLUSTER',
        memberResourceRefs: [claimA, claimB],
        patternIdentity: 'cluster:claims-a-b',
        patternStatement: 'These claims repeatedly occur in the same context.',
      },
      relatedResourceRefs: [claimA, claimB],
    },
    {
      findingType: 'CONFLICT_HYPOTHESIS',
      payload: {
        schemaVersion: '1.0.0',
        payloadType: 'CONFLICT_HYPOTHESIS',
        participatingResourceRefs: [claimA, claimB],
        contradictionKind: 'FACTUAL',
        possibleContradiction: 'The two current claims assert incompatible values.',
      },
      relatedResourceRefs: [claimA, claimB],
    },
    {
      findingType: 'CLARIFICATION_QUESTION',
      payload: {
        schemaVersion: '1.0.0',
        payloadType: 'CLARIFICATION_QUESTION',
        investigationTargetRefs: [conflict],
        question: 'Which evidence resolves the known conflict?',
        context: 'The conflict is already registered as a current resource.',
        proposedNextStep: 'Ask the owner to identify the authoritative source.',
      },
      relatedResourceRefs: [conflict],
    },
    {
      findingType: 'ACTION_SUGGESTION',
      payload: {
        schemaVersion: '1.0.0',
        payloadType: 'ACTION_SUGGESTION',
        suggestedAction: 'Review the two claims together.',
        rationale: 'A human review can determine whether the possible contradiction is real.',
        affectedResourceRefs: [claimA, claimB],
        riskContext: 'No action is proposed automatically.',
        executionStatus: 'CANDIDATE_ONLY',
      },
      relatedResourceRefs: [claimA, claimB],
    },
  ];
};

describe.runIf(databaseUrl)('AKP-2 WP2 Discovery finding PostgreSQL persistence', () => {
  const pool: Pool = createPostgresPool(databaseUrl!);

  beforeAll(async () => {
    await migrateUpTo(undefined, databaseUrl!);
  });

  afterAll(async () => {
    const client = await pool.connect();
    try {
      await client.query('SET session_replication_role = replica');
      for (const project of projectIds) {
        await client.query(
          'DELETE FROM discovery.finding_lifecycle_history WHERE project_id = $1',
          [project],
        );
        await client.query(
          'DELETE FROM discovery.finding_lifecycle_current WHERE project_id = $1',
          [project],
        );
        await client.query('DELETE FROM discovery.findings WHERE project_id = $1', [project]);
      }
    } finally {
      await client.query('SET session_replication_role = origin');
      client.release();
    }
    await pool.end();
  });

  it('applies the migration and keeps the legacy Stage-10 table separate', async () => {
    const result = await pool.query<{ findings_table: string | null; legacy_table: string | null }>(
      `SELECT to_regclass('discovery.findings')::text AS findings_table,
              to_regclass('projection.discovery_inferences')::text AS legacy_table`,
    );
    expect(result.rows[0]).toEqual({
      findings_table: 'discovery.findings',
      legacy_table: 'projection.discovery_inferences',
    });
  });

  it('round-trips all seven payloads, lineage, security, provenance and action boundaries', async () => {
    const project = projectId('roundtrip');
    const repository = new PostgresDiscoveryFindingRepository(pool);
    for (const [index, entry] of payloadEntries(project).entries()) {
      const finding = makeFinding({
        projectId: project,
        findingId: `finding-${index}`,
        ...entry,
      });
      expect(await repository.save(finding)).toBe('CREATED');
      expect(
        await repository.findRevision({
          projectId: project,
          findingId: finding.findingId,
          findingRevision: finding.findingRevision,
        }),
      ).toEqual(finding);
    }

    const findings = await repository.listByProject(project);
    expect(findings).toHaveLength(7);
    expect(findings.map((finding) => finding.findingType)).toEqual([
      'KNOWLEDGE_GAP',
      'EVIDENCE_GAP',
      'RELATION_HYPOTHESIS',
      'PATTERN_HYPOTHESIS',
      'CONFLICT_HYPOTHESIS',
      'CLARIFICATION_QUESTION',
      'ACTION_SUGGESTION',
    ]);
    const action = findings.find((finding) => finding.findingType === 'ACTION_SUGGESTION');
    expect(action?.payload).toMatchObject({ executionStatus: 'CANDIDATE_ONLY' });

    const decision = ref(project, 'decision-1', 'CANONICAL_DECISION');
    const decisionFinding = makeFinding({
      projectId: project,
      findingId: 'decision-lineage-finding',
      findingType: 'CLARIFICATION_QUESTION',
      payload: {
        schemaVersion: '1.0.0',
        payloadType: 'CLARIFICATION_QUESTION',
        investigationTargetRefs: [decision],
        question: 'Which evidence resolves the known decision?',
        context: 'The decision is already registered as a current resource.',
        proposedNextStep: 'Ask the owner to identify the authoritative evidence.',
      },
      relatedResourceRefs: [decision],
    });
    expect(await repository.save(decisionFinding)).toBe('CREATED');
    const restoredDecisionFinding = await repository.findRevision({
      projectId: project,
      findingId: decisionFinding.findingId,
      findingRevision: decisionFinding.findingRevision,
    });
    expect(restoredDecisionFinding).toEqual(decisionFinding);
    expect(restoredDecisionFinding?.relatedResourceRefs[0]?.resourceKind).toBe(
      'CANONICAL_DECISION',
    );

    const normalized = normalizeDiscoveryFingerprintInputV1({
      findingType: 'CLARIFICATION_QUESTION',
      relatedResourceRefs: [decision],
      semanticEssence: 'Resolve the decision lineage.',
      fingerprintVersion: 'discovery-fingerprint-v1',
    });
    expect(normalized.relatedResourceRefs).toEqual([decision]);
  });

  it('preserves complete AI and HYBRID execution identity without secrets', async () => {
    const project = projectId('provenance');
    const repository = new PostgresDiscoveryFindingRepository(pool);
    const aiExecution = {
      providerId: 'provider-wp2',
      modelId: 'model-wp2',
      modelVersion: 'model-revision-4',
      aiConfigurationRevision: 'config-revision-8',
      credentialId: 'credential-wp2-a',
      credentialRevision: 'credential-revision-3',
      providerPolicyFingerprint: 'sha256:provider-policy',
      privacyPolicyRevision: 'privacy-revision-2',
      dataPolicyRevision: 'data-revision-2',
      promptVersion: 'prompt-v5',
      outputSchemaVersion: 'output-v2',
    } as const;
    const ai = makeFinding({
      projectId: project,
      findingId: 'ai-finding',
      findingType: 'KNOWLEDGE_GAP',
      payload: payloadEntries(project)[0]!.payload,
      relatedResourceRefs: [],
      generationMethod: 'AI_ASSISTED',
      provenance: { schemaVersion: '1.0.0', kind: 'AI_ASSISTED', ...aiExecution },
    });
    expect(await repository.save(ai)).toBe('CREATED');
    expect(
      (await repository.findLatest({ projectId: project, findingId: ai.findingId }))?.provenance,
    ).toEqual({ schemaVersion: '1.0.0', kind: 'AI_ASSISTED', ...aiExecution });

    const hybrid = makeFinding({
      projectId: project,
      findingId: 'hybrid-finding',
      findingType: 'EVIDENCE_GAP',
      payload: payloadEntries(project)[1]!.payload,
      relatedResourceRefs: payloadEntries(project)[1]!.relatedResourceRefs,
      generationMethod: 'HYBRID',
      provenance: {
        schemaVersion: '1.0.0',
        kind: 'HYBRID',
        deterministic: {
          ruleId: deterministic.ruleId,
          ruleVersion: deterministic.ruleVersion,
          inputDigest: deterministic.inputDigest,
        },
        aiExecution,
      },
    });
    expect(await repository.save(hybrid)).toBe('CREATED');
    expect(
      (await repository.findLatest({ projectId: project, findingId: hybrid.findingId }))
        ?.provenance,
    ).toEqual({
      schemaVersion: '1.0.0',
      kind: 'HYBRID',
      deterministic: {
        ruleId: deterministic.ruleId,
        ruleVersion: deterministic.ruleVersion,
        inputDigest: deterministic.inputDigest,
      },
      aiExecution,
    });
  });

  it('does not overwrite duplicate identity, retains revisions, and isolates projects', async () => {
    const projectA = projectId('project-a');
    const projectB = projectId('project-b');
    const repository = new PostgresDiscoveryFindingRepository(pool);
    const first = makeFinding({
      projectId: projectA,
      findingId: 'same-finding',
      findingType: 'KNOWLEDGE_GAP',
      payload: payloadEntries(projectA)[0]!.payload,
      relatedResourceRefs: [],
    });
    expect(await repository.save(first)).toBe('CREATED');
    expect(await repository.save(first)).toBe('CONFLICT');
    const second = makeFinding({
      ...first,
      findingRevision: 2,
      payload: {
        schemaVersion: '1.0.0',
        payloadType: 'KNOWLEDGE_GAP',
        gapKind: 'MISSING_FACT',
        subject: 'Milo',
        missingFact: 'revised current weight',
        question: "What is Milo's revised current weight?",
      },
    });
    expect(await repository.save(second)).toBe('CREATED');
    expect(
      (await repository.findLatest({ projectId: projectA, findingId: first.findingId }))
        ?.findingRevision,
    ).toBe(2);
    expect(
      await repository.findRevision({
        projectId: projectA,
        findingId: first.findingId,
        findingRevision: 1,
      }),
    ).toEqual(first);

    const otherProject = makeFinding({
      projectId: projectB,
      findingId: first.findingId,
      findingType: 'KNOWLEDGE_GAP',
      payload: payloadEntries(projectB)[0]!.payload,
      relatedResourceRefs: [],
    });
    expect(await repository.save(otherProject)).toBe('CREATED');
    expect(
      await repository.findRevision({
        projectId: projectA,
        findingId: otherProject.findingId,
        findingRevision: otherProject.findingRevision,
      }),
    ).toMatchObject({ projectId: projectA, findingId: otherProject.findingId });
    expect(
      await repository.findRevision({
        projectId: projectB,
        findingId: otherProject.findingId,
        findingRevision: otherProject.findingRevision,
      }),
    ).toEqual(otherProject);
    expect(await repository.listByProject(projectA)).toHaveLength(2);
    expect(await repository.listByProject(projectB)).toHaveLength(1);
    const legacyRows = await pool.query(
      'SELECT count(*)::int AS count FROM projection.discovery_inferences WHERE project_id = $1',
      [projectA],
    );
    expect(legacyRows.rows[0]?.count).toBe(0);
  });

  it('fails closed when a persisted envelope row is malformed', async () => {
    const project = projectId('corrupt');
    const repository = new PostgresDiscoveryFindingRepository(pool);
    const finding = makeFinding({
      projectId: project,
      findingId: 'corruptible-finding',
      findingType: 'KNOWLEDGE_GAP',
      payload: payloadEntries(project)[0]!.payload,
      relatedResourceRefs: [],
    });
    expect(await repository.save(finding)).toBe('CREATED');
    await pool.query(
      `UPDATE discovery.findings
       SET payload = payload || '{"unexpected":"corruption"}'::jsonb
       WHERE project_id = $1 AND finding_id = $2 AND finding_revision = $3`,
      [project, finding.findingId, finding.findingRevision],
    );
    await expect(
      repository.findRevision({
        projectId: project,
        findingId: finding.findingId,
        findingRevision: finding.findingRevision,
      }),
    ).rejects.toThrow('unknown field');
  });
});
