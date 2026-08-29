import type {
  DiscoveryFindingEnvelopeV1,
  DiscoveryFindingRevision,
} from '../../../packages/contracts/src/index.js';

export type DiscoveryFindingLookupV1 = {
  readonly projectId: string;
  readonly findingId: string;
  readonly findingRevision: DiscoveryFindingRevision;
};

export type DiscoveryFindingLatestLookupV1 = {
  readonly projectId: string;
  readonly findingId: string;
};

/**
 * Durable persistence is deliberately narrower than the Discovery contract:
 * it stores and retrieves the frozen envelope, but does not hash, reconcile,
 * mutate lifecycle state, or promote findings into Canonical.
 */
export type DiscoveryFindingRepositoryPort = {
  save(finding: DiscoveryFindingEnvelopeV1): Promise<'CREATED' | 'CONFLICT'>;
  findRevision(lookup: DiscoveryFindingLookupV1): Promise<DiscoveryFindingEnvelopeV1 | undefined>;
  findLatest(
    lookup: DiscoveryFindingLatestLookupV1,
  ): Promise<DiscoveryFindingEnvelopeV1 | undefined>;
  listByProject(projectId: string): Promise<readonly DiscoveryFindingEnvelopeV1[]>;
};
