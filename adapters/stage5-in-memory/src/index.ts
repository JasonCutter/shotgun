import type {
  CanonicalSnapshotPort,
  ComparisonRepositoryPort,
} from '../../../modules/comparison/src/index.js';
import type {
  ChangeSetReviewRepositoryPort,
  ReviewDecisionWrite,
} from '../../../modules/change-set-review/src/index.js';
import {
  type ApprovedChangeSetManifest,
  canonicalSnapshotDigest,
  type CanonicalSnapshot,
  type CanonicalSnapshotClaim,
  type ComparisonResult,
  type DraftChangeSet,
  type ReversalDraftChangeSetV1,
  stableJson,
  ShotgunError,
} from '../../../packages/contracts/src/index.js';

const clone = <T>(value: T): T => structuredClone(value);

export class InMemoryCanonicalSnapshotAdapter implements CanonicalSnapshotPort {
  private readonly snapshots = new Map<string, CanonicalSnapshot>();

  constructor(
    initial: Readonly<Record<string, readonly CanonicalSnapshotClaim[]>> = {},
    createdAt = '1970-01-01T00:00:00.000Z',
  ) {
    for (const [projectId, claims] of Object.entries(initial)) {
      this.snapshots.set(projectId, this.build(projectId, 1, claims, createdAt));
    }
  }

  async getSnapshot(projectId: string): Promise<CanonicalSnapshot> {
    return clone(
      this.snapshots.get(projectId) ?? this.build(projectId, 0, [], '1970-01-01T00:00:00.000Z'),
    );
  }

  replaceClaims(
    projectId: string,
    claims: readonly CanonicalSnapshotClaim[],
    createdAt = new Date().toISOString(),
  ): CanonicalSnapshot {
    const version = (this.snapshots.get(projectId)?.version ?? 0) + 1;
    const snapshot = this.build(projectId, version, claims, createdAt);
    this.snapshots.set(projectId, snapshot);
    return clone(snapshot);
  }

  private build(
    projectId: string,
    version: number,
    claims: readonly CanonicalSnapshotClaim[],
    createdAt: string,
  ): CanonicalSnapshot {
    return {
      snapshotId: `canonical:${projectId}:${version}`,
      projectId,
      version,
      digest: canonicalSnapshotDigest(projectId, version, claims),
      claims: clone(claims),
      createdAt,
    };
  }
}

export class InMemoryComparisonRepository implements ComparisonRepositoryPort {
  private readonly results = new Map<string, ComparisonResult>();
  private readonly identities = new Map<string, string>();

  async save(result: ComparisonResult): Promise<ComparisonResult> {
    const identity = `${result.projectId}:${result.candidateId}:${result.snapshotDigest}`;
    const existingId = this.identities.get(identity);
    const existing = existingId ? this.results.get(existingId) : undefined;
    if (existing) {
      if (
        stableJson({ ...existing, comparisonId: undefined }) !==
        stableJson({ ...result, comparisonId: undefined })
      ) {
        throw new ShotgunError({
          code: 'CONFLICT',
          safeMessage: 'The same Candidate and Snapshot produced a different comparison.',
          module: 'stage5-in-memory',
          operation: 'save-comparison',
        });
      }
      return clone(existing);
    }
    this.identities.set(identity, result.comparisonId);
    this.results.set(result.comparisonId, clone(result));
    return clone(result);
  }

  async findById(projectId: string, comparisonId: string): Promise<ComparisonResult | undefined> {
    const result = this.results.get(comparisonId);
    return result?.projectId === projectId ? clone(result) : undefined;
  }

  async findByCandidateAndSnapshot(
    projectId: string,
    candidateId: string,
    snapshotDigest: string,
  ): Promise<ComparisonResult | undefined> {
    const id = this.identities.get(`${projectId}:${candidateId}:${snapshotDigest}`);
    const result = id ? this.results.get(id) : undefined;
    return result ? clone(result) : undefined;
  }

  count(): number {
    return this.results.size;
  }
}

export class InMemoryChangeSetReviewRepository implements ChangeSetReviewRepositoryPort {
  private readonly changeSets = new Map<string, DraftChangeSet>();
  private readonly comparisons = new Map<string, string>();
  private readonly manifests = new Map<string, ApprovedChangeSetManifest>();
  // FE-P5-S2 WP5 (Round 4 Option 1): owning-Domain Reversal durable authority.
  private readonly reversals = new Map<string, ReversalDraftChangeSetV1>();

  async save(changeSet: DraftChangeSet): Promise<DraftChangeSet> {
    const comparisonKey = `${changeSet.projectId}:${changeSet.comparisonId}`;
    const existingId = this.comparisons.get(comparisonKey);
    const existing = existingId ? this.changeSets.get(existingId) : undefined;
    if (existing) {
      if (
        stableJson({ ...existing, changeSetId: undefined }) !==
        stableJson({ ...changeSet, changeSetId: undefined })
      ) {
        throw new ShotgunError({
          code: 'CONFLICT',
          safeMessage: 'The same Comparison produced a different Draft Change Set.',
          module: 'stage5-in-memory',
          operation: 'save-draft-change-set',
        });
      }
      return clone(existing);
    }
    this.comparisons.set(comparisonKey, changeSet.changeSetId);
    this.changeSets.set(changeSet.changeSetId, clone(changeSet));
    return clone(changeSet);
  }

  async findById(projectId: string, changeSetId: string): Promise<DraftChangeSet | undefined> {
    const result = this.changeSets.get(changeSetId);
    return result?.projectId === projectId ? clone(result) : undefined;
  }

  async findByComparisonId(
    projectId: string,
    comparisonId: string,
  ): Promise<DraftChangeSet | undefined> {
    const id = this.comparisons.get(`${projectId}:${comparisonId}`);
    const result = id ? this.changeSets.get(id) : undefined;
    return result ? clone(result) : undefined;
  }

  async listBySourceVersion(
    projectId: string,
    sourceVersionId: string,
  ): Promise<readonly DraftChangeSet[]> {
    return [...this.changeSets.values()]
      .filter((item) => item.projectId === projectId && item.sourceVersionId === sourceVersionId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map(clone);
  }

  async findDecision(
    projectId: string,
    decisionId: string,
  ): Promise<
    | {
        readonly changeSet: DraftChangeSet;
        readonly decision: DraftChangeSet['decisions'][number];
        readonly manifest?: ApprovedChangeSetManifest;
      }
    | undefined
  > {
    for (const changeSet of this.changeSets.values()) {
      if (changeSet.projectId !== projectId) {
        continue;
      }
      const decision = changeSet.decisions.find((item) => item.decisionId === decisionId);
      if (decision) {
        return {
          changeSet: clone(changeSet),
          decision: clone(decision),
          manifest: clone(this.manifests.get(changeSet.changeSetId)),
        };
      }
    }
    return undefined;
  }

  async recordDecision(write: ReviewDecisionWrite): Promise<{
    readonly changeSet: DraftChangeSet;
    readonly manifest?: ApprovedChangeSetManifest;
  }> {
    const current = this.changeSets.get(write.changeSetId);
    if (!current || current.projectId !== write.projectId) {
      throw new ShotgunError({
        code: 'NOT_FOUND',
        safeMessage: 'The Draft Change Set was not found.',
        module: 'stage5-in-memory',
        operation: 'record-review-decision',
      });
    }
    const existingDecision = current.decisions.find(
      (item) => item.decisionId === write.decision.decisionId,
    );
    if (existingDecision) {
      if (stableJson(existingDecision) !== stableJson(write.decision)) {
        throw new ShotgunError({
          code: 'CONFLICT',
          safeMessage: 'The review decision id was reused with different content.',
          module: 'stage5-in-memory',
          operation: 'record-review-decision',
        });
      }
      return {
        changeSet: clone(current),
        manifest: clone(this.manifests.get(write.changeSetId)),
      };
    }
    if (
      current.revisionNumber !== write.expectedRevisionNumber ||
      current.contentDigest !== write.expectedContentDigest
    ) {
      throw new ShotgunError({
        code: 'STALE_VERSION',
        safeMessage: 'The Draft Change Set changed before the decision was stored.',
        module: 'stage5-in-memory',
        operation: 'record-review-decision',
      });
    }
    if (['APPROVED', 'REJECTED', 'STALE'].includes(current.status)) {
      throw new ShotgunError({
        code: 'CONFLICT',
        safeMessage: 'The Draft Change Set already has a final status.',
        module: 'stage5-in-memory',
        operation: 'record-review-decision',
      });
    }
    this.changeSets.set(write.changeSetId, clone(write.updated));
    if (write.manifest) {
      this.manifests.set(write.changeSetId, clone(write.manifest));
    }
    return {
      changeSet: clone(write.updated),
      manifest: clone(write.manifest),
    };
  }

  async markStale(
    projectId: string,
    changeSetId: string,
    expectedContentDigest: string,
    updatedAt: string,
  ): Promise<DraftChangeSet> {
    const current = this.changeSets.get(changeSetId);
    if (!current || current.projectId !== projectId) {
      throw new ShotgunError({
        code: 'NOT_FOUND',
        safeMessage: 'The Draft Change Set was not found.',
        module: 'stage5-in-memory',
        operation: 'mark-change-set-stale',
      });
    }
    if (current.contentDigest !== expectedContentDigest) {
      throw new ShotgunError({
        code: 'STALE_VERSION',
        safeMessage: 'The Draft Change Set changed before it could be marked stale.',
        module: 'stage5-in-memory',
        operation: 'mark-change-set-stale',
      });
    }
    if (current.status === 'STALE') {
      return clone(current);
    }
    if (['APPROVED', 'REJECTED'].includes(current.status)) {
      throw new ShotgunError({
        code: 'CONFLICT',
        safeMessage: 'A final Draft Change Set cannot be marked stale.',
        module: 'stage5-in-memory',
        operation: 'mark-change-set-stale',
      });
    }
    const stale = { ...current, status: 'STALE' as const, updatedAt };
    this.changeSets.set(changeSetId, stale);
    return clone(stale);
  }

  async findApprovedManifest(
    projectId: string,
    changeSetId: string,
  ): Promise<ApprovedChangeSetManifest | undefined> {
    const manifest = this.manifests.get(changeSetId);
    return manifest?.projectId === projectId ? clone(manifest) : undefined;
  }

  // FE-P5-S2 WP5 (Round 4 Option 1): owning-Domain Reversal durable authority.
  async saveReversal(reversal: ReversalDraftChangeSetV1): Promise<ReversalDraftChangeSetV1> {
    this.reversals.set(reversal.reversalId, clone(reversal));
    return clone(reversal);
  }

  async findReversalById(
    projectId: string,
    reversalId: string,
  ): Promise<ReversalDraftChangeSetV1 | undefined> {
    const result = this.reversals.get(reversalId);
    return result?.resourceProjectId === projectId ? clone(result) : undefined;
  }

  async listReversals(projectId: string): Promise<readonly ReversalDraftChangeSetV1[]> {
    return [...this.reversals.values()]
      .filter((item) => item.resourceProjectId === projectId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map(clone);
  }

  counts() {
    return {
      changeSets: this.changeSets.size,
      manifests: this.manifests.size,
      decisions: [...this.changeSets.values()].reduce(
        (total, item) => total + item.decisions.length,
        0,
      ),
    };
  }
}
