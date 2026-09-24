import type {
  KnowledgeResetBlockerCodeV1,
  KnowledgeResetImpactCountsV1,
  KnowledgeResetRequestV1,
  KnowledgeResetStateV1,
} from './index.js';

/**
 * Ordered owner list from ADR-171 and the T3 storage register. A maintenance
 * composition is unavailable until it supplies every owner, even when an
 * owner has no rows for the selected Project.
 */
export const KNOWLEDGE_RESET_OWNER_ORDER = [
  'external-action',
  'action',
  'ask',
  'review',
  'knowledge-draft',
  'comparison',
  'validation',
  'candidate',
  'ai-output',
  'projection',
  'knowledge-graph',
  'activity',
  'history',
  'canonical',
  'discovery',
  'knowledge',
  'source-product',
  'intake',
  'evidence',
  'transformation',
  'asset',
  'connector',
  'frontend-command',
  'project-audit',
  'settings',
] as const;

export type KnowledgeResetOwnerId = (typeof KNOWLEDGE_RESET_OWNER_ORDER)[number];
export type KnowledgeResetOwnerPhase = 'fence' | 'purge' | 'rebuild' | 'verify';

export type KnowledgeResetOwnerContext = Readonly<{
  projectId: string;
  requestId: string;
  knowledgeEpoch: number;
  manifestDigest: `sha256:${string}`;
}>;

export type KnowledgeResetOwnerPort = Readonly<{
  ownerId: KnowledgeResetOwnerId;
  fence(input: KnowledgeResetOwnerContext): Promise<void>;
  purge(input: KnowledgeResetOwnerContext): Promise<void>;
  rebuild(input: KnowledgeResetOwnerContext): Promise<void>;
  verify(input: KnowledgeResetOwnerContext): Promise<{
    readonly verified: boolean;
    readonly blockerCodes: readonly KnowledgeResetBlockerCodeV1[];
  }>;
}>;

export type KnowledgeResetExecutionRepositoryPort = Readonly<{
  readForExecution(input: { projectId: string; requestId: string }): Promise<{
    readonly request: KnowledgeResetRequestV1;
    readonly completedSteps: readonly string[];
  } | null>;
  setExecutionState(input: {
    projectId: string;
    requestId: string;
    state: KnowledgeResetStateV1;
    blockerCodes: readonly KnowledgeResetBlockerCodeV1[];
  }): Promise<void>;
  markExecutionStepComplete(input: {
    projectId: string;
    requestId: string;
    step: string;
  }): Promise<void>;
  markExecutionComplete(input: {
    projectId: string;
    requestId: string;
  }): Promise<KnowledgeResetRequestV1>;
}>;

export type KnowledgeResetMaintenanceBoundaryPort = Readonly<{
  assertDedicatedExecutor(): Promise<void>;
  withExclusiveMaintenanceLock<T>(action: () => Promise<T>): Promise<T>;
}>;

export type KnowledgeResetExecutionDependencies = Readonly<{
  repository: KnowledgeResetExecutionRepositoryPort;
  maintenance: KnowledgeResetMaintenanceBoundaryPort;
  owners: readonly KnowledgeResetOwnerPort[];
  inspectApprovedImpact(projectId: string): Promise<{
    readonly counts: KnowledgeResetImpactCountsV1;
    readonly blockers: readonly KnowledgeResetBlockerCodeV1[];
    readonly manifestDigest: `sha256:${string}`;
  }>;
  fingerprintPreservedConfiguration(projectId: string): Promise<`sha256:${string}`>;
  appendJournal(input: {
    projectId: string;
    requestId: string;
    knowledgeEpoch: number;
    phase: 'PREPARED' | 'VERIFIED';
  }): Promise<void>;
}>;

export class KnowledgeResetExecutionError extends Error {
  constructor(
    readonly blockerCode: KnowledgeResetBlockerCodeV1,
    message: string,
    readonly terminalState: 'BLOCKED' | 'ERASURE_UNVERIFIED' = 'BLOCKED',
  ) {
    super(message);
    this.name = 'KnowledgeResetExecutionError';
  }
}

const ownerOrderIndex = new Map<KnowledgeResetOwnerId, number>(
  KNOWLEDGE_RESET_OWNER_ORDER.map((ownerId, index) => [ownerId, index]),
);

export const assertCompleteKnowledgeResetOwnerSet = (
  owners: readonly KnowledgeResetOwnerPort[],
): readonly KnowledgeResetOwnerPort[] => {
  const seen = new Set<KnowledgeResetOwnerId>();
  for (const owner of owners) {
    if (seen.has(owner.ownerId)) {
      throw new Error(`Duplicate Source knowledge reset owner: ${owner.ownerId}.`);
    }
    seen.add(owner.ownerId);
  }
  const missing = KNOWLEDGE_RESET_OWNER_ORDER.filter((ownerId) => !seen.has(ownerId));
  if (missing.length > 0) {
    throw new KnowledgeResetExecutionError(
      'UNCLASSIFIED_CONTENT',
      `Source knowledge reset owner closure is incomplete: ${missing.join(', ')}.`,
    );
  }
  return [...owners].sort(
    (left, right) => ownerOrderIndex.get(left.ownerId)! - ownerOrderIndex.get(right.ownerId)!,
  );
};

const checkpointName = (phase: KnowledgeResetOwnerPhase, ownerId: KnowledgeResetOwnerId): string =>
  `${phase}:${ownerId}`;

const blockerFor = (error: unknown): KnowledgeResetBlockerCodeV1 =>
  error instanceof KnowledgeResetExecutionError ? error.blockerCode : 'UNCLASSIFIED_CONTENT';

const sameCounts = (
  left: KnowledgeResetImpactCountsV1,
  right: KnowledgeResetImpactCountsV1,
): boolean =>
  (Object.keys(left) as (keyof KnowledgeResetImpactCountsV1)[])
    .sort()
    .every((key) => left[key] === right[key]) &&
  Object.keys(left).length === Object.keys(right).length;

const isAfterPurge = (state: KnowledgeResetStateV1): boolean =>
  state === 'PURGING' ||
  state === 'REBUILDING' ||
  state === 'VERIFYING' ||
  state === 'OUTCOME_UNKNOWN' ||
  state === 'ERASURE_UNVERIFIED';

const runOwnerPhase = async (input: {
  readonly phase: KnowledgeResetOwnerPhase;
  readonly owner: KnowledgeResetOwnerPort;
  readonly context: KnowledgeResetOwnerContext;
  readonly completedSteps: Set<string>;
  readonly repository: KnowledgeResetExecutionRepositoryPort;
}): Promise<void> => {
  const step = checkpointName(input.phase, input.owner.ownerId);
  // Fences are renewed on every process start. Their checkpoints prove that
  // the phase once completed, but do not prove an in-memory worker pause still
  // exists after a crash released the maintenance lock.
  if (input.phase !== 'fence' && input.completedSteps.has(step)) return;
  if (input.phase === 'fence') await input.owner.fence(input.context);
  else if (input.phase === 'purge') await input.owner.purge(input.context);
  else if (input.phase === 'rebuild') await input.owner.rebuild(input.context);
  else {
    const result = await input.owner.verify(input.context);
    if (!result.verified || result.blockerCodes.length > 0) {
      throw new KnowledgeResetExecutionError(
        result.blockerCodes[0] ?? 'UNCLASSIFIED_CONTENT',
        `Source knowledge reset readback did not close for owner ${input.owner.ownerId}.`,
        'ERASURE_UNVERIFIED',
      );
    }
  }
  await input.repository.markExecutionStepComplete({
    projectId: input.context.projectId,
    requestId: input.context.requestId,
    step,
  });
  input.completedSteps.add(step);
};

export const createKnowledgeResetMaintenanceExecutor = (
  dependencies: KnowledgeResetExecutionDependencies,
) => {
  const owners = assertCompleteKnowledgeResetOwnerSet(dependencies.owners);

  return {
    async execute(input: {
      projectId: string;
      requestId: string;
    }): Promise<KnowledgeResetRequestV1> {
      await dependencies.maintenance.assertDedicatedExecutor();
      return dependencies.maintenance.withExclusiveMaintenanceLock(async () => {
        const snapshot = await dependencies.repository.readForExecution(input);
        if (!snapshot) {
          throw new KnowledgeResetExecutionError(
            'UNCLASSIFIED_CONTENT',
            'Reset request was not found.',
          );
        }
        const request = snapshot.request;
        if (request.projectId !== input.projectId || request.requestId !== input.requestId) {
          throw new KnowledgeResetExecutionError(
            'UNCLASSIFIED_CONTENT',
            'Reset request identity does not match the maintenance command.',
          );
        }
        if (request.state === 'COMPLETE') return request;
        if (!request.preservedConfigurationDigest) {
          throw new KnowledgeResetExecutionError(
            'UNCLASSIFIED_CONTENT',
            'Approved reset request has no durable preserved-configuration fingerprint.',
          );
        }
        if (!request.ownerManifestDigest) {
          throw new KnowledgeResetExecutionError(
            'UNCLASSIFIED_CONTENT',
            'Approved reset request has no durable owner impact fingerprint.',
          );
        }
        if (
          !Number.isSafeInteger(request.expectedKnowledgeEpoch) ||
          request.expectedKnowledgeEpoch < 0 ||
          request.knowledgeEpoch !== request.expectedKnowledgeEpoch + 1
        ) {
          throw new KnowledgeResetExecutionError(
            'UNCLASSIFIED_CONTENT',
            'Reset request knowledge epoch is invalid.',
          );
        }
        if (
          request.state !== 'APPROVED' &&
          request.state !== 'FENCING' &&
          request.state !== 'PURGING' &&
          request.state !== 'REBUILDING' &&
          request.state !== 'VERIFYING' &&
          request.state !== 'BLOCKED' &&
          request.state !== 'OUTCOME_UNKNOWN' &&
          request.state !== 'ERASURE_UNVERIFIED'
        ) {
          throw new KnowledgeResetExecutionError(
            'RESET_IN_PROGRESS',
            `Reset request cannot resume from state ${request.state}.`,
          );
        }

        const context: KnowledgeResetOwnerContext = {
          projectId: request.projectId,
          requestId: request.requestId,
          knowledgeEpoch: request.knowledgeEpoch,
          manifestDigest: request.manifestDigest,
        };
        const completedSteps = new Set(snapshot.completedSteps);
        let contentMutationPossible = isAfterPurge(request.state);
        const phaseComplete = (phase: KnowledgeResetOwnerPhase): boolean =>
          owners.every((owner) => completedSteps.has(checkpointName(phase, owner.ownerId)));
        try {
          // A prior process may have completed every durable fence checkpoint
          // and then crashed after a content commit. Its error transition marks
          // the epoch RESET_UNVERIFIED, so restore the write fence before
          // renewing the owner fences on every execution attempt.
          await dependencies.repository.setExecutionState({
            ...input,
            state: 'FENCING',
            blockerCodes: [],
          });
          for (const owner of owners) {
            await runOwnerPhase({
              phase: 'fence',
              owner,
              context,
              completedSteps,
              repository: dependencies.repository,
            });
          }

          // Fence and drain every owner before comparing the approved impact
          // manifest. Persist this checkpoint so forward recovery after purge
          // does not compare the intentionally shrinking store to its old
          // manifest.
          if (!completedSteps.has('manifest:approved-impact')) {
            const currentImpact = await dependencies.inspectApprovedImpact(request.projectId);
            if (currentImpact.blockers.length > 0) {
              throw new KnowledgeResetExecutionError(
                currentImpact.blockers[0]!,
                'A Source dependency became blocked after reset approval.',
              );
            }
            if (
              currentImpact.manifestDigest !== request.ownerManifestDigest ||
              !sameCounts(currentImpact.counts, request.counts)
            ) {
              throw new KnowledgeResetExecutionError(
                'STALE_PREVIEW',
                'Source dependencies changed after reset approval; preview again.',
              );
            }
            await dependencies.repository.markExecutionStepComplete({
              ...input,
              step: 'manifest:approved-impact',
            });
            completedSteps.add('manifest:approved-impact');
          }
          const beforeFingerprint = await dependencies.fingerprintPreservedConfiguration(
            request.projectId,
          );
          if (beforeFingerprint !== request.preservedConfigurationDigest) {
            throw new KnowledgeResetExecutionError(
              'UNCLASSIFIED_CONTENT',
              'Preserved Project/Auth/AI configuration changed after reset approval.',
            );
          }

          // The HMAC journal is durable before any owner is allowed to mutate
          // content. PREPARED append is idempotent for this request and epoch.
          await dependencies.appendJournal({ ...context, phase: 'PREPARED' });
          if (!phaseComplete('purge')) {
            await dependencies.repository.setExecutionState({
              ...input,
              state: 'PURGING',
              blockerCodes: [],
            });
            contentMutationPossible = true;
          }
          for (const owner of owners) {
            await runOwnerPhase({
              phase: 'purge',
              owner,
              context,
              completedSteps,
              repository: dependencies.repository,
            });
          }

          if (!phaseComplete('rebuild')) {
            await dependencies.repository.setExecutionState({
              ...input,
              state: 'REBUILDING',
              blockerCodes: [],
            });
          }
          for (const owner of owners) {
            await runOwnerPhase({
              phase: 'rebuild',
              owner,
              context,
              completedSteps,
              repository: dependencies.repository,
            });
          }

          if (!phaseComplete('verify')) {
            await dependencies.repository.setExecutionState({
              ...input,
              state: 'VERIFYING',
              blockerCodes: [],
            });
          }
          for (const owner of owners) {
            await runOwnerPhase({
              phase: 'verify',
              owner,
              context,
              completedSteps,
              repository: dependencies.repository,
            });
          }
          const afterFingerprint = await dependencies.fingerprintPreservedConfiguration(
            request.projectId,
          );
          if (afterFingerprint !== request.preservedConfigurationDigest) {
            throw new KnowledgeResetExecutionError(
              'UNCLASSIFIED_CONTENT',
              'Project/Auth/AI configuration fingerprint changed during Source knowledge reset.',
              'ERASURE_UNVERIFIED',
            );
          }

          await dependencies.appendJournal({ ...context, phase: 'VERIFIED' });
          return dependencies.repository.markExecutionComplete(input);
        } catch (error) {
          const terminalState =
            error instanceof KnowledgeResetExecutionError &&
            error.terminalState === 'ERASURE_UNVERIFIED'
              ? 'ERASURE_UNVERIFIED'
              : contentMutationPossible
                ? 'OUTCOME_UNKNOWN'
                : 'BLOCKED';
          await dependencies.repository.setExecutionState({
            ...input,
            state: terminalState,
            blockerCodes: [blockerFor(error)],
          });
          throw error;
        }
      });
    },
  };
};
