import type { Pool } from 'pg';

import { PostgresDiscoveryFindingRepository } from '../../discovery-finding-postgres/src/index.js';
import { PostgresDiscoveryReentryRepository } from '../../discovery-reentry-postgres/src/index.js';
import { PostgresEvidenceRepository } from '../../postgres-stage3/src/index.js';
import { createPostgresReviewDiscoveryCandidateReader } from '../../frontend-review-postgres/src/index.js';
import type {
  ReviewDiscoveryCandidateDerivedSourceV1,
  ReviewDiscoveryCandidateReader,
} from '../../frontend-review-in-memory/src/index.js';
import type {
  DiscoveryResourceRefV1,
  DiscoveryReviewLineageV1,
  KnowledgeResourceResolverPort,
  SemanticProductResourceType,
} from '../../../packages/contracts/src/index.js';
import type {
  DiscoveryProductReadSource,
  DiscoveryProductResourceAuthorizationV1,
  DiscoveryProductReviewBindingV1,
} from '../../../modules/frontend-discovery-product/src/index.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type SourceSecurityReader = {
  findSourceVersionSecurity(
    projectId: string,
    sourceVersionId: string,
  ): Promise<
    | {
        readonly projectId: string;
        readonly sourceId: string;
        readonly sourceVersionId: string;
        readonly versionNumber?: number;
        readonly accessScope: readonly string[];
        readonly sensitivity: DiscoveryProductResourceAuthorizationV1['sensitivity'];
      }
    | undefined
  >;
  findSourceSecurity?(
    projectId: string,
    sourceId: string,
  ): Promise<
    | {
        readonly projectId: string;
        readonly sourceId: string;
        readonly versionNumber?: number;
        readonly accessScope: readonly string[];
        readonly sensitivity: DiscoveryProductResourceAuthorizationV1['sensitivity'];
      }
    | undefined
  >;
};

const SEMANTIC_RESOURCE_TYPES: readonly SemanticProductResourceType[] = [
  'CLAIM',
  'ENTITY',
  'RELATION',
  'EVENT',
  'DECISION',
];

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
  private readonly resourceResolver?: KnowledgeResourceResolverPort;
  private readonly sourceSecurityReader?: SourceSecurityReader;

  public constructor(
    private readonly pool: Pool,
    options: {
      readonly reviewReader?: ReviewDiscoveryCandidateReader;
      readonly evidenceRepository?: PostgresEvidenceRepository;
      readonly resourceResolver?: KnowledgeResourceResolverPort;
      readonly sourceSecurityReader?: SourceSecurityReader;
    } = {},
  ) {
    this.findingRepository = new PostgresDiscoveryFindingRepository(pool);
    this.reentryRepository = new PostgresDiscoveryReentryRepository(pool, {
      lifecycleRepository: this.findingRepository,
    });
    this.evidenceRepository = options.evidenceRepository ?? new PostgresEvidenceRepository(pool);
    this.reviewReader = options.reviewReader ?? createPostgresReviewDiscoveryCandidateReader(pool);
    this.resourceResolver = options.resourceResolver;
    this.sourceSecurityReader = options.sourceSecurityReader;
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
    const matching = this.reviewReader.findByFinding
      ? await this.reviewReader.findByFinding(
          input.projectId,
          input.findingId,
          input.findingRevision,
        )
      : undefined;
    const isDerived = (
      candidate: NonNullable<typeof matching>,
    ): candidate is ReviewDiscoveryCandidateDerivedSourceV1 =>
      'origin' in candidate && candidate.origin === 'DERIVED_DISCOVERY';
    if (!matching || !isDerived(matching)) return undefined;
    const lineage = matching.lineage as DiscoveryReviewLineageV1;
    if (
      lineage.projectId !== input.projectId ||
      lineage.findingId !== input.findingId ||
      lineage.findingRevision !== input.findingRevision
    ) {
      return undefined;
    }
    return {
      projectId: matching.resourceProjectId,
      findingId: lineage.findingId,
      findingRevision: lineage.findingRevision,
      reviewResourceId: matching.reviewResourceId,
      resourceRevision: matching.resourceRevision,
      lifecycleState: 'REVIEW_READY',
      reviewEligibility: 'ELIGIBLE_AFTER_VALIDATION',
    };
  }

  public async findResourceAuthorization(
    resource: DiscoveryResourceRefV1,
  ): Promise<DiscoveryProductResourceAuthorizationV1 | undefined> {
    if (resource.projectId.trim().length === 0 || resource.resourceId.trim().length === 0) {
      return undefined;
    }
    if (resource.resourceKind === 'SOURCE_VERSION') {
      if (resource.resourceState !== 'CURRENT') return undefined;
      const resolved = await this.sourceSecurityReader?.findSourceVersionSecurity(
        resource.projectId,
        resource.resourceId,
      );
      if (
        !resolved ||
        resolved.projectId !== resource.projectId ||
        resolved.sourceVersionId !== resource.resourceId
      ) {
        return undefined;
      }
      const resourceRevision =
        resolved.versionNumber === undefined ? undefined : String(resolved.versionNumber);
      if (
        resource.resourceRevision !== undefined &&
        resourceRevision !== resource.resourceRevision
      ) {
        return undefined;
      }
      return {
        projectId: resolved.projectId,
        resourceKind: resource.resourceKind,
        resourceId: resolved.sourceVersionId,
        resourceState: resource.resourceState,
        ...(resourceRevision === undefined ? {} : { resourceRevision }),
        accessScope: resolved.accessScope,
        sensitivity: resolved.sensitivity,
        graphEligible: false,
      };
    }
    if (resource.resourceKind === 'SOURCE') {
      if (resource.resourceState !== 'CURRENT') return undefined;
      const resolved = await this.sourceSecurityReader?.findSourceSecurity?.(
        resource.projectId,
        resource.resourceId,
      );
      if (
        !resolved ||
        resolved.projectId !== resource.projectId ||
        resolved.sourceId !== resource.resourceId
      ) {
        return undefined;
      }
      const resourceRevision =
        resolved.versionNumber === undefined ? undefined : String(resolved.versionNumber);
      if (
        resource.resourceRevision !== undefined &&
        resourceRevision !== resource.resourceRevision
      ) {
        return undefined;
      }
      return {
        projectId: resolved.projectId,
        resourceKind: resource.resourceKind,
        resourceId: resolved.sourceId,
        resourceState: resource.resourceState,
        ...(resourceRevision === undefined ? {} : { resourceRevision }),
        accessScope: resolved.accessScope,
        sensitivity: resolved.sensitivity,
        graphEligible: false,
      };
    }
    if (resource.resourceKind === 'CANONICAL_CONFLICT') return undefined;
    if (
      (resource.resourceKind === 'CANONICAL_CLAIM' ||
        resource.resourceKind === 'COMPILED_TRUTH_ITEM') &&
      resource.resourceState !== 'CURRENT'
    ) {
      return undefined;
    }
    if (!this.resourceResolver) return undefined;
    const semanticType = resource.resourceKind.replace(
      'CANONICAL_',
      '',
    ) as SemanticProductResourceType;
    const types =
      resource.resourceKind === 'COMPILED_TRUTH_ITEM'
        ? SEMANTIC_RESOURCE_TYPES
        : ([semanticType] satisfies readonly SemanticProductResourceType[]);
    const expectedAuthority =
      resource.resourceKind === 'COMPILED_TRUTH_ITEM'
        ? 'COMPILED_TRUTH'
        : resource.resourceState === 'APPROVED'
          ? 'APPROVED_KNOWLEDGE'
          : 'CANONICAL';
    for (const type of types) {
      const resolved = await this.resourceResolver.resolveResource(
        resource.projectId,
        type,
        resource.resourceId,
        expectedAuthority,
      );
      if (
        !resolved ||
        resolved.authority !== expectedAuthority ||
        !resolved.accessScope ||
        !resolved.sensitivity
      ) {
        continue;
      }
      const resourceRevision =
        resolved.resourceRevision === undefined ? undefined : String(resolved.resourceRevision);
      if (
        resource.resourceRevision !== undefined &&
        resourceRevision !== resource.resourceRevision
      ) {
        continue;
      }
      return {
        projectId: resource.projectId,
        resourceKind: resource.resourceKind,
        resourceId: resource.resourceId,
        resourceState: resource.resourceState,
        ...(resourceRevision === undefined ? {} : { resourceRevision }),
        accessScope: resolved.accessScope,
        sensitivity: resolved.sensitivity,
        graphEligible: true,
      };
    }
    return undefined;
  }

  public findEvidence(projectId: string, evidenceId: string) {
    // Evidence persistence uses UUID identity. Malformed or stale envelope
    // references are a non-disclosing miss, not a database query error.
    if (!UUID_PATTERN.test(evidenceId)) return Promise.resolve(undefined);
    return this.evidenceRepository.findById(projectId, evidenceId);
  }
}

export const createPostgresFrontendDiscoveryProductReadSource = (
  pool: Pool,
  options: ConstructorParameters<typeof PostgresFrontendDiscoveryProductReadSource>[1] = {},
): DiscoveryProductReadSource => new PostgresFrontendDiscoveryProductReadSource(pool, options);
