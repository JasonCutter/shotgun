import type { Pool } from 'pg';

import { PostgresDiscoveryFindingRepository } from '../../discovery-finding-postgres/src/index.js';
import { PostgresDiscoveryReentryRepository } from '../../discovery-reentry-postgres/src/index.js';
import { PostgresEvidenceRepository } from '../../postgres-stage3/src/index.js';
import { createPostgresReviewDiscoveryCandidateReader } from '../../frontend-review-postgres/src/index.js';
import type {
  ReviewDiscoveryCandidateDerivedSourceV1,
  ReviewDiscoveryCandidateReader,
} from '../../frontend-review-in-memory/src/index.js';
import type { DiscoveryReviewLineageV1 } from '../../../packages/contracts/src/index.js';
import type {
  DiscoveryProductReadSource,
  DiscoveryProductReviewBindingV1,
} from '../../../modules/frontend-discovery-product/src/index.js';

/**
 * AKP-6 WP1 PostgreSQL read adapter.
 *
 * This adapter deliberately composes the existing immutable Finding,
 * authoritative lifecycle, re-entry disposition, Review-resource and Evidence
 * authorities. It has no write methods and does not introduce a migration or
 * a second Product-owned state store.
 */
export class PostgresFrontendDiscoveryProductReadSource implements DiscoveryProductReadSource {
  private readonly findingRepository: PostgresDiscoveryFindingRepository;
  private readonly reentryRepository: PostgresDiscoveryReentryRepository;
  private readonly evidenceRepository: PostgresEvidenceRepository;
  private readonly reviewReader: ReviewDiscoveryCandidateReader;

  public constructor(
    private readonly pool: Pool,
    options: {
      readonly reviewReader?: ReviewDiscoveryCandidateReader;
      readonly evidenceRepository?: PostgresEvidenceRepository;
    } = {},
  ) {
    this.findingRepository = new PostgresDiscoveryFindingRepository(pool);
    this.reentryRepository = new PostgresDiscoveryReentryRepository(pool, {
      lifecycleRepository: this.findingRepository,
    });
    this.evidenceRepository = options.evidenceRepository ?? new PostgresEvidenceRepository(pool);
    this.reviewReader = options.reviewReader ?? createPostgresReviewDiscoveryCandidateReader(pool);
  }

  public async listFindings(
    projectId: string,
    after: Parameters<DiscoveryProductReadSource['listFindings']>[1],
    limit: number,
  ) {
    return this.findingRepository.listByProjectPage(projectId, after, limit);
  }

  public findFinding(input: Parameters<DiscoveryProductReadSource['findFinding']>[0]) {
    return this.findingRepository.findRevision(input);
  }

  public findLifecycle(input: Parameters<DiscoveryProductReadSource['findLifecycle']>[0]) {
    return this.findingRepository.findLifecycle(input);
  }

  public async findReentryDisposition(
    input: Parameters<DiscoveryProductReadSource['findReentryDisposition']>[0],
  ) {
    const record = await this.reentryRepository.findConsumptionDisposition(input);
    return record?.disposition;
  }

  public async findReviewBinding(
    input: Parameters<DiscoveryProductReadSource['findReviewBinding']>[0],
  ): Promise<DiscoveryProductReviewBindingV1 | undefined> {
    const resources = await this.reviewReader.list(input.projectId);
    const isDerived = (
      candidate: (typeof resources)[number],
    ): candidate is ReviewDiscoveryCandidateDerivedSourceV1 =>
      'origin' in candidate && candidate.origin === 'DERIVED_DISCOVERY';
    const matching = resources.find((candidate) => {
      if (!isDerived(candidate)) return false;
      const lineage = candidate.lineage as DiscoveryReviewLineageV1;
      return (
        lineage.projectId === input.projectId &&
        lineage.findingId === input.findingId &&
        lineage.findingRevision === input.findingRevision
      );
    });
    if (!matching || !isDerived(matching)) return undefined;
    return {
      projectId: matching.resourceProjectId,
      findingId: matching.lineage.findingId,
      findingRevision: matching.lineage.findingRevision,
      reviewResourceId: matching.reviewResourceId,
      resourceRevision: matching.resourceRevision,
      lifecycleState: 'REVIEW_READY',
      reviewEligibility: 'ELIGIBLE_AFTER_VALIDATION',
    };
  }

  public findEvidence(projectId: string, evidenceId: string) {
    return this.evidenceRepository.findById(projectId, evidenceId);
  }
}

export const createPostgresFrontendDiscoveryProductReadSource = (
  pool: Pool,
  options: ConstructorParameters<typeof PostgresFrontendDiscoveryProductReadSource>[1] = {},
): DiscoveryProductReadSource => new PostgresFrontendDiscoveryProductReadSource(pool, options);
