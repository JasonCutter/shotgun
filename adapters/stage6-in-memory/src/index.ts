import type { CanonicalSnapshotPort } from '../../../modules/comparison/src/index.js';
import type {
  CanonicalCommitWrite,
  CanonicalKnowledgeRepositoryPort,
} from '../../../modules/canonical-knowledge/src/index.js';
import {
  canonicalSnapshotDigest,
  canonicalRelationLogicalIdentityV1,
  type CanonicalClaim,
  type CanonicalCommitResult,
  type CanonicalHistoryEvent,
  type CanonicalOutboxRecord,
  type CanonicalRelationV1,
  type CanonicalRelationPrecursorLinkV1,
  type CanonicalRevision,
  type CanonicalSnapshot,
  type FrontendCanonicalCommitWrite,
  stableJson,
  ShotgunError,
} from '../../../packages/contracts/src/index.js';

const clone = <T>(value: T): T => structuredClone(value);

const relationPrecursorKey = (
  projectId: string,
  reviewResourceId: string,
  reviewResourceRevision: number,
): string => `${projectId}:${reviewResourceId}:${reviewResourceRevision}`;

type ProjectState = {
  readonly version: number;
  readonly digest: string;
  readonly updatedAt: string;
};

export class InMemoryCanonicalKnowledgeRepository
  implements CanonicalKnowledgeRepositoryPort, CanonicalSnapshotPort
{
  private readonly states = new Map<string, ProjectState>();
  private readonly claims = new Map<string, CanonicalClaim>();
  private readonly relations = new Map<string, CanonicalRelationV1>();
  private readonly relationPrecursorLinks = new Map<string, CanonicalRelationPrecursorLinkV1>();
  private readonly commits = new Map<string, CanonicalCommitResult>();
  private readonly revisions = new Map<string, CanonicalRevision>();
  private readonly history = new Map<string, CanonicalHistoryEvent>();
  private readonly outbox = new Map<string, CanonicalOutboxRecord>();

  async listProjectIds(): Promise<readonly string[]> {
    return [
      ...new Set([
        ...this.states.keys(),
        ...[...this.outbox.values()]
          .filter((record) => record.status !== 'published')
          .map((record) => record.projectId),
      ]),
    ].sort();
  }

  async getSnapshot(projectId: string): Promise<CanonicalSnapshot> {
    const claims = [...this.claims.values()]
      .filter((claim) => claim.projectId === projectId)
      .sort((left, right) => left.claimId.localeCompare(right.claimId))
      .map((claim) => ({
        claimId: claim.claimId,
        text: claim.claimText,
        revisionNumber: claim.revisionNumber,
        evidenceIds: claim.evidenceIds,
      }));
    const state = this.states.get(projectId) ?? {
      version: 0,
      digest: canonicalSnapshotDigest(projectId, 0, []),
      updatedAt: '1970-01-01T00:00:00.000Z',
    };
    const relations = [...this.relations.values()]
      .filter((relation) => relation.projectId === projectId)
      .sort((left, right) => left.relationId.localeCompare(right.relationId))
      .map((relation) => ({
        relationId: relation.relationId,
        logicalIdentityKey: relation.logicalIdentityKey,
        revisionNumber: relation.revisionNumber,
        relationType: relation.relationType,
        fromEndpoint: relation.fromEndpoint,
        toEndpoint: relation.toEndpoint,
        direction: relation.direction,
        ...(relation.validFrom === undefined ? {} : { validFrom: relation.validFrom }),
        ...(relation.validTo === undefined ? {} : { validTo: relation.validTo }),
        evidenceIds: relation.evidenceIds,
      }));
    return clone({
      snapshotId: `canonical:${projectId}:${state.version}`,
      projectId,
      version: state.version,
      digest: state.digest,
      claims,
      ...(relations.length === 0 ? {} : { relations }),
      ...(() => {
        const links = [...this.relationPrecursorLinks.values()]
          .filter((link) => link.projectId === projectId)
          .sort((left, right) =>
            `${left.reviewResourceId}:${left.reviewResourceRevision}`.localeCompare(
              `${right.reviewResourceId}:${right.reviewResourceRevision}`,
            ),
          );
        return links.length === 0 ? {} : { relationPrecursorLinks: links };
      })(),
      createdAt: state.updatedAt,
    });
  }

  async commit(write: CanonicalCommitWrite): Promise<CanonicalCommitResult> {
    const existing = this.commits.get(write.commitId);
    if (existing) {
      if (
        existing.projectId !== write.manifest.projectId ||
        existing.manifestDigest !== write.manifest.manifestDigest
      ) {
        throw new ShotgunError({
          code: 'CONFLICT',
          safeMessage: 'The Canonical Commit id was reused with different approved content.',
          module: 'stage6-in-memory',
          operation: 'commit-canonical',
        });
      }
      return clone(existing);
    }

    const before = await this.getSnapshot(write.manifest.projectId);
    if (
      before.version !== write.manifest.expectedCanonicalVersion ||
      before.digest !== write.manifest.snapshotDigest
    ) {
      throw new ShotgunError({
        code: 'STALE_APPROVAL',
        safeMessage: 'The Canonical Snapshot changed after approval.',
        module: 'stage6-in-memory',
        operation: 'commit-canonical',
      });
    }

    const claim: CanonicalClaim | undefined =
      write.manifest.operation === 'ADD_CLAIM' && write.claimId
        ? {
            claimId: write.claimId,
            projectId: write.manifest.projectId,
            revisionNumber: 1,
            claimText: write.manifest.claimText,
            sourceVersionId: write.manifest.sourceVersionId,
            evidenceIds: [...write.manifest.evidenceIds],
            createdFromManifestId: write.manifest.manifestId,
            authorityId: null,
            authorityDigest: null,
            accessScope: [...write.manifest.accessScope],
            sensitivity: write.manifest.sensitivity,
            createdAt: write.committedAt,
          }
        : undefined;
    const afterClaims = claim
      ? [
          ...before.claims,
          {
            claimId: claim.claimId,
            text: claim.claimText,
            revisionNumber: claim.revisionNumber,
            evidenceIds: claim.evidenceIds,
          },
        ]
      : before.claims;
    const afterVersion = claim ? before.version + 1 : before.version;
    const afterDigest = canonicalSnapshotDigest(
      write.manifest.projectId,
      afterVersion,
      afterClaims,
    );
    const result: CanonicalCommitResult = {
      commitId: write.commitId,
      projectId: write.manifest.projectId,
      manifestId: write.manifest.manifestId,
      manifestDigest: write.manifest.manifestDigest,
      changeSetId: write.manifest.changeSetId,
      authorityId: null,
      authorityDigest: null,
      operation: write.manifest.operation,
      status: claim ? 'COMMITTED' : 'NO_OP',
      beforeVersion: before.version,
      afterVersion,
      snapshotDigest: afterDigest,
      claimId: claim?.claimId,
      revisionId: write.revisionId,
      historyEventId: write.historyEventId,
      outboxId: write.outboxId,
      committedAt: write.committedAt,
    };
    const revision: CanonicalRevision = {
      revisionId: write.revisionId,
      projectId: write.manifest.projectId,
      commitId: write.commitId,
      manifestId: write.manifest.manifestId,
      operation: write.manifest.operation,
      beforeVersion: before.version,
      afterVersion,
      claimId: claim?.claimId,
      reason: write.manifest.reason,
      actor: write.actor,
      createdAt: write.committedAt,
    };
    const history: CanonicalHistoryEvent = {
      historyEventId: write.historyEventId,
      projectId: write.manifest.projectId,
      commitId: write.commitId,
      manifestId: write.manifest.manifestId,
      changeSetId: write.manifest.changeSetId,
      eventType: claim ? 'CANONICAL_CLAIM_ADDED' : 'CHANGESET_NO_OP',
      beforeVersion: before.version,
      afterVersion,
      claimId: claim?.claimId,
      reason: write.manifest.reason,
      actor: write.actor,
      createdAt: write.committedAt,
    };
    const outbox: CanonicalOutboxRecord = {
      outboxId: write.outboxId,
      projectId: write.manifest.projectId,
      aggregateId: write.commitId,
      eventType: 'CanonicalCommitted',
      payload: {
        commitId: write.commitId,
        manifestId: write.manifest.manifestId,
        changeSetId: write.manifest.changeSetId,
        operation: write.manifest.operation,
        status: result.status,
        canonicalVersion: afterVersion,
        snapshotDigest: afterDigest,
        claimId: claim?.claimId,
        actorId: write.actor.id,
        accessScope: [...write.manifest.accessScope],
        sensitivity: write.manifest.sensitivity,
      },
      status: 'pending',
      attempts: 0,
      availableAt: write.committedAt,
    };

    if (
      this.revisions.has(write.revisionId) ||
      this.history.has(write.historyEventId) ||
      this.outbox.has(write.outboxId) ||
      (claim && this.claims.has(claim.claimId))
    ) {
      throw new ShotgunError({
        code: 'CONFLICT',
        safeMessage: 'A Canonical append-only identity already exists.',
        module: 'stage6-in-memory',
        operation: 'commit-canonical',
      });
    }

    if (claim) {
      this.claims.set(claim.claimId, clone(claim));
    }
    this.states.set(write.manifest.projectId, {
      version: afterVersion,
      digest: afterDigest,
      updatedAt: write.committedAt,
    });
    this.commits.set(write.commitId, clone(result));
    this.revisions.set(write.revisionId, clone(revision));
    this.history.set(write.historyEventId, clone(history));
    this.outbox.set(write.outboxId, clone(outbox));
    return clone(result);
  }

  async commitFrontendDraft(write: FrontendCanonicalCommitWrite): Promise<CanonicalCommitResult> {
    // Replay guard: same commitId must carry the same authority (project +
    // approval id + binding digest; Round 3 GPT #1).
    const existing = this.commits.get(write.commitId);
    if (existing) {
      if (
        existing.projectId !== write.projectId ||
        existing.authorityId !== write.authority.approvalId ||
        existing.authorityDigest !== write.authority.approvalBindingDigest
      ) {
        throw new ShotgunError({
          code: 'CONFLICT',
          safeMessage: 'The Canonical Commit id was reused with different frontend authority.',
          module: 'stage6-in-memory',
          operation: 'commit-frontend-draft',
        });
      }
      return clone(existing);
    }

    // One approval -> at most one canonical commit (in-memory mirror of DB UNIQUE).
    const existingByApproval = [...this.commits.values()].find(
      (commit) =>
        commit.authorityId === write.authority.approvalId &&
        commit.projectId === write.projectId &&
        commit.commitId !== write.commitId,
    );
    if (existingByApproval) {
      throw new ShotgunError({
        code: 'CONFLICT',
        safeMessage: 'A Canonical Commit for this approval already exists.',
        module: 'stage6-in-memory',
        operation: 'commit-frontend-draft',
      });
    }

    const before = await this.getSnapshot(write.projectId);
    if (
      before.version !== write.expectedCanonicalVersion ||
      before.digest !== write.snapshotDigest
    ) {
      throw new ShotgunError({
        code: 'STALE_APPROVAL',
        safeMessage: 'The Canonical Snapshot changed after approval.',
        module: 'stage6-in-memory',
        operation: 'commit-frontend-draft',
      });
    }

    const claim: CanonicalClaim | undefined =
      write.operation === 'ADD_CLAIM'
        ? {
            claimId: write.claimId,
            projectId: write.projectId,
            revisionNumber: 1,
            claimText: write.claimText,
            sourceVersionId: write.sourceVersionId,
            evidenceIds: [...write.evidenceIds],
            createdFromManifestId: null,
            authorityId: write.authority.approvalId,
            authorityDigest: write.authority.approvalBindingDigest,
            accessScope: [...write.accessScope],
            sensitivity: write.sensitivity,
            createdAt: write.committedAt,
          }
        : undefined;
    const relation: CanonicalRelationV1 | undefined =
      write.operation === 'ADD_RELATION'
        ? {
            relationId: write.relationId,
            logicalIdentityKey: write.logicalIdentityKey,
            projectId: write.projectId,
            revisionNumber: 1,
            relationType: write.relationType,
            fromEndpoint: write.fromEndpoint,
            toEndpoint: write.toEndpoint,
            direction: write.direction,
            ...(write.validFrom === undefined ? {} : { validFrom: write.validFrom }),
            ...(write.validTo === undefined ? {} : { validTo: write.validTo }),
            evidenceIds: [...write.evidenceIds],
            accessScope: [...write.accessScope],
            sensitivity: write.sensitivity,
            authority: write.authority,
            ...(write.discoveryProvenanceRef === undefined
              ? {}
              : { discoveryProvenanceRef: write.discoveryProvenanceRef }),
            ...(write.discoveryProvenanceRevision === undefined
              ? {}
              : { discoveryProvenanceRevision: write.discoveryProvenanceRevision }),
            createdAt: write.committedAt,
          }
        : undefined;
    if (
      relation &&
      ((relation.discoveryProvenanceRef !== undefined &&
        relation.discoveryProvenanceRef.trim().length === 0) ||
        (relation.discoveryProvenanceRevision !== undefined &&
          (relation.discoveryProvenanceRef === undefined ||
            !Number.isSafeInteger(relation.discoveryProvenanceRevision) ||
            relation.discoveryProvenanceRevision < 1)))
    ) {
      throw new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage: 'The Discovery authoring precursor linkage is invalid.',
        module: 'stage6-in-memory',
        operation: 'commit-frontend-draft',
      });
    }
    const relationPrecursorLink: CanonicalRelationPrecursorLinkV1 | undefined =
      relation?.discoveryProvenanceRef === undefined ||
      relation.discoveryProvenanceRevision === undefined
        ? undefined
        : {
            projectId: relation.projectId,
            reviewResourceId: relation.discoveryProvenanceRef,
            reviewResourceRevision: relation.discoveryProvenanceRevision!,
            relationId: relation.relationId,
            relationRevision: relation.revisionNumber,
            linkedAt: relation.createdAt,
          };
    if (
      relation !== undefined &&
      canonicalRelationLogicalIdentityV1(relation) !== relation.logicalIdentityKey
    ) {
      throw new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage: 'The Canonical Relation logical identity is invalid.',
        module: 'stage6-in-memory',
        operation: 'commit-frontend-draft',
      });
    }
    const afterClaims = claim
      ? [
          ...before.claims,
          {
            claimId: claim.claimId,
            text: claim.claimText,
            revisionNumber: claim.revisionNumber,
            evidenceIds: claim.evidenceIds,
          },
        ]
      : before.claims;
    const afterRelations = relation
      ? [
          ...(before.relations ?? []),
          {
            relationId: relation.relationId,
            logicalIdentityKey: relation.logicalIdentityKey,
            revisionNumber: relation.revisionNumber,
            relationType: relation.relationType,
            fromEndpoint: relation.fromEndpoint,
            toEndpoint: relation.toEndpoint,
            direction: relation.direction,
            ...(relation.validFrom === undefined ? {} : { validFrom: relation.validFrom }),
            ...(relation.validTo === undefined ? {} : { validTo: relation.validTo }),
            evidenceIds: relation.evidenceIds,
          },
        ]
      : before.relations;
    const changed = claim !== undefined || relation !== undefined;
    const afterVersion = changed ? before.version + 1 : before.version;
    const afterDigest = canonicalSnapshotDigest(
      write.projectId,
      afterVersion,
      afterClaims,
      afterRelations,
    );
    const result: CanonicalCommitResult = {
      commitId: write.commitId,
      projectId: write.projectId,
      manifestId: null,
      manifestDigest: null,
      changeSetId: null,
      authorityId: write.authority.approvalId,
      authorityDigest: write.authority.approvalBindingDigest,
      operation: write.operation,
      status: changed ? 'COMMITTED' : 'NO_OP',
      beforeVersion: before.version,
      afterVersion,
      snapshotDigest: afterDigest,
      ...(claim === undefined ? {} : { claimId: claim.claimId }),
      ...(relation === undefined
        ? {}
        : { relationId: relation.relationId, logicalIdentityKey: relation.logicalIdentityKey }),
      revisionId: write.revisionId,
      historyEventId: write.historyEventId,
      outboxId: write.outboxId,
      committedAt: write.committedAt,
    };
    const revision: CanonicalRevision = {
      revisionId: write.revisionId,
      projectId: write.projectId,
      commitId: write.commitId,
      manifestId: null,
      operation: write.operation,
      beforeVersion: before.version,
      afterVersion,
      ...(claim === undefined ? {} : { claimId: claim.claimId }),
      ...(relation === undefined ? {} : { relationId: relation.relationId }),
      reason: write.reason,
      actor: write.actor,
      createdAt: write.committedAt,
    };
    const history: CanonicalHistoryEvent = {
      historyEventId: write.historyEventId,
      projectId: write.projectId,
      commitId: write.commitId,
      manifestId: null,
      changeSetId: null,
      eventType: claim
        ? 'CANONICAL_CLAIM_ADDED'
        : relation
          ? 'CANONICAL_RELATION_ADDED'
          : 'CHANGESET_NO_OP',
      beforeVersion: before.version,
      afterVersion,
      ...(claim === undefined ? {} : { claimId: claim.claimId }),
      ...(relation === undefined ? {} : { relationId: relation.relationId }),
      reason: write.reason,
      actor: write.actor,
      createdAt: write.committedAt,
    };
    const outbox: CanonicalOutboxRecord = {
      outboxId: write.outboxId,
      projectId: write.projectId,
      aggregateId: write.commitId,
      eventType: 'CanonicalCommitted',
      payload: {
        commitId: write.commitId,
        manifestId: null,
        changeSetId: null,
        operation: write.operation,
        status: result.status,
        canonicalVersion: afterVersion,
        snapshotDigest: afterDigest,
        ...(claim === undefined ? {} : { claimId: claim.claimId }),
        ...(relation === undefined
          ? {}
          : { relationId: relation.relationId, logicalIdentityKey: relation.logicalIdentityKey }),
        actorId: write.actor.id,
        accessScope: claim ? [...claim.accessScope] : relation ? [...relation.accessScope] : [],
        sensitivity: claim ? claim.sensitivity : relation ? relation.sensitivity : 'public',
      },
      status: 'pending',
      attempts: 0,
      availableAt: write.committedAt,
    };

    const duplicateRelation =
      relation !== undefined &&
      (this.relations.has(relation.relationId) ||
        [...this.relations.values()].some(
          (existing) =>
            existing.projectId === relation.projectId &&
            existing.logicalIdentityKey === relation.logicalIdentityKey,
        ) ||
        (relationPrecursorLink !== undefined &&
          this.relationPrecursorLinks.has(
            relationPrecursorKey(
              relationPrecursorLink.projectId,
              relationPrecursorLink.reviewResourceId,
              relationPrecursorLink.reviewResourceRevision,
            ),
          )));
    if (
      this.revisions.has(write.revisionId) ||
      this.history.has(write.historyEventId) ||
      this.outbox.has(write.outboxId) ||
      (claim && this.claims.has(claim.claimId)) ||
      duplicateRelation
    ) {
      throw new ShotgunError({
        code: 'CONFLICT',
        safeMessage: 'A Canonical append-only identity already exists.',
        module: 'stage6-in-memory',
        operation: 'commit-frontend-draft',
      });
    }

    if (claim) {
      this.claims.set(claim.claimId, clone(claim));
    }
    if (relation) {
      this.relations.set(relation.relationId, clone(relation));
    }
    if (relationPrecursorLink) {
      this.relationPrecursorLinks.set(
        relationPrecursorKey(
          relationPrecursorLink.projectId,
          relationPrecursorLink.reviewResourceId,
          relationPrecursorLink.reviewResourceRevision,
        ),
        clone(relationPrecursorLink),
      );
    }
    this.states.set(write.projectId, {
      version: afterVersion,
      digest: afterDigest,
      updatedAt: write.committedAt,
    });
    this.commits.set(write.commitId, clone(result));
    this.revisions.set(write.revisionId, clone(revision));
    this.history.set(write.historyEventId, clone(history));
    this.outbox.set(write.outboxId, clone(outbox));
    return clone(result);
  }

  async findClaim(projectId: string, claimId: string): Promise<CanonicalClaim | undefined> {
    const claim = this.claims.get(claimId);
    return claim?.projectId === projectId ? clone(claim) : undefined;
  }

  async findRelationPrecursorLink(
    projectId: string,
    reviewResourceId: string,
    reviewResourceRevision: number,
  ): Promise<CanonicalRelationPrecursorLinkV1 | undefined> {
    return clone(
      this.relationPrecursorLinks.get(
        relationPrecursorKey(projectId, reviewResourceId, reviewResourceRevision),
      ),
    );
  }

  async findCommit(
    projectId: string,
    commitId: string,
  ): Promise<CanonicalCommitResult | undefined> {
    const commit = this.commits.get(commitId);
    return commit?.projectId === projectId ? clone(commit) : undefined;
  }

  async findRevision(
    projectId: string,
    revisionId: string,
  ): Promise<CanonicalRevision | undefined> {
    const revision = this.revisions.get(revisionId);
    return revision?.projectId === projectId ? clone(revision) : undefined;
  }

  async listHistory(projectId: string): Promise<readonly CanonicalHistoryEvent[]> {
    return [...this.history.values()]
      .filter((event) => event.projectId === projectId)
      .sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) ||
          left.historyEventId.localeCompare(right.historyEventId),
      )
      .map(clone);
  }

  async findOutbox(
    projectId: string,
    outboxId: string,
  ): Promise<CanonicalOutboxRecord | undefined> {
    const record = this.outbox.get(outboxId);
    return record?.projectId === projectId ? clone(record) : undefined;
  }

  async claimOutbox(
    projectId: string,
    limit: number,
    claimedAt: string,
    staleBefore: string,
  ): Promise<readonly CanonicalOutboxRecord[]> {
    const records = [...this.outbox.values()]
      .filter(
        (record) =>
          record.projectId === projectId &&
          (record.status === 'pending' ||
            (record.status === 'processing' &&
              record.claimedAt !== undefined &&
              record.claimedAt < staleBefore)),
      )
      .sort(
        (left, right) =>
          left.availableAt.localeCompare(right.availableAt) ||
          left.outboxId.localeCompare(right.outboxId),
      )
      .slice(0, limit)
      .map((record) => ({
        ...record,
        status: 'processing' as const,
        attempts: record.attempts + 1,
        claimedAt,
        lastError: undefined,
      }));
    for (const record of records) {
      this.outbox.set(record.outboxId, clone(record));
    }
    return records.map(clone);
  }

  async markOutboxPublished(
    projectId: string,
    outboxId: string,
    attempt: number,
    publishedAt: string,
  ): Promise<void> {
    const record = this.outbox.get(outboxId);
    if (
      !record ||
      record.projectId !== projectId ||
      record.status !== 'processing' ||
      record.attempts !== attempt
    ) {
      throw new ShotgunError({
        code: 'CONFLICT',
        safeMessage: 'The Outbox claim is no longer current.',
        module: 'stage6-in-memory',
        operation: 'mark-outbox-published',
      });
    }
    this.outbox.set(outboxId, {
      ...record,
      status: 'published',
      publishedAt,
      claimedAt: undefined,
    });
  }

  async releaseOutbox(
    projectId: string,
    outboxId: string,
    attempt: number,
    error: string,
  ): Promise<void> {
    const record = this.outbox.get(outboxId);
    if (
      record?.projectId === projectId &&
      record.status === 'processing' &&
      record.attempts === attempt
    ) {
      this.outbox.set(outboxId, {
        ...record,
        status: 'pending',
        claimedAt: undefined,
        lastError: error,
      });
    }
  }

  counts() {
    return {
      claims: this.claims.size,
      commits: this.commits.size,
      revisions: this.revisions.size,
      history: this.history.size,
      outbox: this.outbox.size,
      facts: 0,
    };
  }

  fingerprint(): string {
    return stableJson({
      states: [...this.states.entries()],
      claims: [...this.claims.entries()],
      relations: [...this.relations.entries()],
      commits: [...this.commits.entries()],
      relationPrecursorLinks: [...this.relationPrecursorLinks.entries()],
      revisions: [...this.revisions.entries()],
      history: [...this.history.entries()],
      outbox: [...this.outbox.entries()],
    });
  }
}
