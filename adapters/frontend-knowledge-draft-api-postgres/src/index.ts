import type { Pool } from 'pg';

import { canonicalSnapshotDigest } from '../../../packages/contracts/src/comparison-review.js';
import type { FrontendKnowledgeDraftBaseV1 } from '../../../packages/contracts/src/index.js';
import type {
  FrontendKnowledgeDraftCommandScopeV1,
  FrontendKnowledgeDraftTargetResolutionV1,
  FrontendKnowledgeDraftTargetResolverPort,
} from '../../../modules/frontend-knowledge-draft/src/product-api.js';

type TransitionSeedRow = {
  seed_id: string;
  answer_run_id: string;
  project_id: string;
  principal_id: string;
  kind: string;
  state: string;
  payload: unknown;
  request_id: string;
  created_at: Date;
};

type ProjectStateRow = {
  project_id: string;
  version: number;
  snapshot_digest: string;
  updated_at: Date;
};

type CanonicalClaimRow = {
  claim_id: string;
  project_id: string;
  source_version_id: string;
  manifest_id: string;
  claim_json: unknown;
  created_at: Date;
};

type CanonicalRevisionRow = {
  revision_id: string;
  project_id: string;
  commit_id: string;
  revision_json: unknown;
  created_at: Date;
};

type SourceVersionRow = {
  source_version_id: string;
  source_id: string;
};

type CitationView = {
  citationId: string;
  sourceId: string;
  sourceVersionId: string;
  evidenceId: string;
  evidenceIds?: readonly string[];
};

type CanonicalClaim = {
  claimId: string;
  projectId: string;
  sourceVersionId: string;
  evidenceIds: readonly string[];
};

type CanonicalRevision = {
  revisionId: string;
  projectId: string;
  claimId?: string;
};

/** node-postgres already deserializes `jsonb` into JS objects; strings are parsed defensively. */
const PARSE = (value: unknown): unknown => {
  if (typeof value === 'string') return JSON.parse(value);
  return value;
};

/**
 * Production Draft target resolution. Resolves an Ask transition Seed or a
 * Canonical Claim (Knowledge Resource) into a fixed Project binding and a
 * pinned Canonical base derived from real server state:
 *
 * - Seeds: `frontend_ask.transition_seeds` (Project binding) +
 *   `frontend_ask` citation lineage + `canonical.project_state` (pinned
 *   Canonical snapshot). A Seed starts a NEW_RESOURCE_SNAPSHOT Draft.
 * - Resources: `canonical.claims` + `canonical.revisions` (the canonical
 *   claim/revision identity) + `canonical.project_state` +
 *   `asset.source_versions` (source lineage). A Claim starts a
 *   RESOURCE_REVISION Draft.
 * - Pages: no page table exists yet, so `resolvePage` fails closed
 *   (returns undefined) until a Page projection is introduced.
 */
export class PostgresFrontendKnowledgeDraftTargetResolver implements FrontendKnowledgeDraftTargetResolverPort {
  constructor(private readonly pool: Pool) {}

  async resolveSeed(input: {
    readonly seedId: string;
    readonly scope: FrontendKnowledgeDraftCommandScopeV1;
  }): Promise<FrontendKnowledgeDraftTargetResolutionV1 | undefined> {
    const seed = await this.pool.query<TransitionSeedRow>(
      `SELECT seed_id, answer_run_id, project_id, principal_id, kind, state, payload, request_id, created_at
       FROM frontend_ask.transition_seeds
       WHERE seed_id = $1`,
      [input.seedId],
    );
    const row = seed.rows[0];
    if (!row) return undefined;
    const projectId = row.project_id;
    const state = await this.snapshot(projectId);
    const payload = PARSE(row.payload) as { citations?: readonly CitationView[] } | null;
    const citations = Array.isArray(payload?.citations) ? payload.citations : [];
    const sourceLineage = seedLineage(citations);
    const base: FrontendKnowledgeDraftBaseV1 = {
      resourceProjectId: projectId,
      canonicalSnapshotId: state.snapshotId,
      canonicalVersion: state.version,
      canonicalSnapshotDigest: state.snapshotDigest,
      accessRevision: input.scope.accessRevision,
      policyContextRevision: input.scope.policyContextRevision,
      sourceLineage,
      revisionIdentityKind: 'NEW_RESOURCE_SNAPSHOT',
    };
    return {
      target: {
        kind: 'SEED',
        seedId: input.seedId,
        resourceId: `new-resource-${input.seedId}`,
      },
      resourceProjectId: projectId,
      draftProjectId: projectId,
      effectiveProjectId: projectId,
      base,
    };
  }

  async resolveResource(input: {
    readonly resourceId: string;
    readonly scope: FrontendKnowledgeDraftCommandScopeV1;
  }): Promise<FrontendKnowledgeDraftTargetResolutionV1 | undefined> {
    const claims = await this.pool.query<CanonicalClaimRow>(
      `SELECT claim_id, project_id, source_version_id, manifest_id, claim_json, created_at
       FROM canonical.claims
       WHERE claim_id = $1 AND project_id = $2`,
      [input.resourceId, input.scope.activeProjectId],
    );
    const claimRow = claims.rows[0];
    if (!claimRow) return undefined;
    const projectId = claimRow.project_id;
    const claim = PARSE(claimRow.claim_json) as CanonicalClaim;
    const revisions = await this.pool.query<CanonicalRevisionRow>(
      `SELECT revision_id, project_id, commit_id, revision_json, created_at
       FROM canonical.revisions
       WHERE project_id = $1 AND revision_json->>'claimId' = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [projectId, input.resourceId],
    );
    const revisionRow = revisions.rows[0];
    const revision = revisionRow
      ? (PARSE(revisionRow.revision_json) as CanonicalRevision)
      : undefined;
    if (!revisionRow || !revision) return undefined;
    const state = await this.snapshot(projectId);
    const source = await this.pool.query<SourceVersionRow>(
      `SELECT source_version_id, source_id
       FROM asset.source_versions
       WHERE source_version_id = $1`,
      [claim.sourceVersionId],
    );
    const sourceRow = source.rows[0];
    const sourceId = sourceRow?.source_id;
    const sourceLineage = [
      {
        sourceId: sourceId ?? claim.sourceVersionId,
        sourceVersionId: claim.sourceVersionId,
        evidenceSpanIds: [...(claim.evidenceIds ?? [])],
      },
    ];
    const base: FrontendKnowledgeDraftBaseV1 = {
      resourceProjectId: projectId,
      canonicalSnapshotId: state.snapshotId,
      canonicalVersion: state.version,
      canonicalSnapshotDigest: state.snapshotDigest,
      accessRevision: input.scope.accessRevision,
      policyContextRevision: input.scope.policyContextRevision,
      sourceLineage,
      revisionIdentityKind: 'RESOURCE_REVISION',
      canonicalResourceId: input.resourceId,
      canonicalRevisionId: revisionRow.revision_id,
    };
    return {
      target: { kind: 'RESOURCE', resourceId: input.resourceId },
      resourceProjectId: projectId,
      draftProjectId: projectId,
      effectiveProjectId: projectId,
      base,
    };
  }

  async resolvePage(): Promise<FrontendKnowledgeDraftTargetResolutionV1 | undefined> {
    // No Knowledge Page projection exists yet: fail closed until a Page table
    // is introduced. Seed and Resource resolution are authoritative today.
    return undefined;
  }

  private async snapshot(projectId: string): Promise<{
    readonly snapshotId: string;
    readonly version: number;
    readonly snapshotDigest: string;
  }> {
    const state = await this.pool.query<ProjectStateRow>(
      `SELECT project_id, version, snapshot_digest, updated_at
       FROM canonical.project_state
       WHERE project_id = $1`,
      [projectId],
    );
    const row = state.rows[0];
    const version = row?.version ?? 0;
    // The empty-snapshot digest MUST match `PostgresCanonicalKnowledgeRepository`
    // (`canonicalSnapshotDigest(projectId, 0, [])`), never a placeholder:
    // commitFrontendDraft revalidates the pinned Draft base against the live
    // Canonical snapshot and would otherwise fail STALE_APPROVAL on every
    // fresh Draft (Cross-Phase WP-XP2 discovery).
    return {
      snapshotId: `canonical:${projectId}:${version}`,
      version,
      snapshotDigest: row?.snapshot_digest ?? canonicalSnapshotDigest(projectId, 0, []),
    };
  }
}

/** Collapses citation evidence into unique source lineage entries. */
const seedLineage = (
  citations: readonly CitationView[],
): FrontendKnowledgeDraftBaseV1['sourceLineage'] => {
  const bySource = new Map<
    string,
    { sourceId: string; sourceVersionId: string; evidence: string[] }
  >();
  for (const citation of citations) {
    const entry = bySource.get(citation.sourceVersionId) ?? {
      sourceId: citation.sourceId,
      sourceVersionId: citation.sourceVersionId,
      evidence: [],
    };
    const ids = new Set<string>([citation.evidenceId, ...(citation.evidenceIds ?? [])]);
    for (const id of ids) {
      if (!entry.evidence.includes(id)) entry.evidence.push(id);
    }
    bySource.set(citation.sourceVersionId, entry);
  }
  return [...bySource.values()].map((entry) => ({
    sourceId: entry.sourceId,
    sourceVersionId: entry.sourceVersionId,
    evidenceSpanIds: entry.evidence,
  }));
};
