import canonicalCommittedSchema from '../../../packages/contracts/schemas/canonical-committed.v1.schema.json';
import {
  semanticGenerationMatchesSourceWatermark,
  SemanticEmbeddingError,
  type Actor,
  type CanonicalCommittedPayload,
  type EventEnvelope,
  type SecurityContext,
  type SemanticActiveGenerationReaderPort,
  type SemanticCorpusSourceSnapshotReaderPort,
  type SemanticEmbeddingProfile,
  type SemanticEmbeddingProfilePort,
  type SemanticEmbeddingResolverPort,
  type SemanticProjectionRefreshPort,
} from '../../../packages/contracts/src/index.js';
import type { ShotgunModule } from '../../../packages/module-sdk/src/index.js';
import {
  semanticGenerationMatchesCurrentExecution,
  semanticSourceSensitivity,
} from './compatibility.js';

export type SemanticProjectionConvergenceTrigger = 'EVENT' | 'STARTUP' | 'PERIODIC';

export type SemanticProjectionConvergenceAction =
  'NO_OP' | 'REFRESHED' | 'NOT_CONFIGURED' | 'RECOVERY_PENDING' | 'DEGRADED';

export type SemanticProjectionConvergenceResult = {
  readonly projectId: string;
  readonly action: SemanticProjectionConvergenceAction;
  readonly generationId?: string;
  readonly profileRevision?: number;
  readonly canonicalVersion?: number;
  readonly safeFailureCode?:
    | 'CONFIGURATION_REQUIRED'
    | 'CAPABILITY_UNAVAILABLE'
    | 'POLICY_DENIED'
    | 'PROVIDER_FAILURE'
    | 'CONFLICT'
    | 'STALE'
    | 'UNKNOWN';
};

export type SemanticProjectionConvergenceStatus =
  'READY' | 'STALE' | 'RECOVERY_PENDING' | 'DEGRADED' | 'NOT_CONFIGURED';

export type SemanticProjectionConvergenceObservation = {
  readonly projectId: string;
  readonly status: SemanticProjectionConvergenceStatus;
  readonly action: SemanticProjectionConvergenceAction;
  readonly generationId?: string;
  readonly profileRevision?: number;
  readonly canonicalVersion?: number;
  readonly safeFailureCode?: SemanticProjectionConvergenceResult['safeFailureCode'];
  readonly observedAt: string;
};

export type SemanticProjectionConvergenceInput = {
  readonly projectId: string;
  readonly actor: Actor;
  readonly security: SecurityContext;
  readonly trigger: SemanticProjectionConvergenceTrigger;
};

export type SemanticProjectionConvergencePort = {
  converge(input: SemanticProjectionConvergenceInput): Promise<SemanticProjectionConvergenceResult>;
  readonly observations?: () => readonly SemanticProjectionConvergenceObservation[];
};

type ConvergenceDependencies = {
  readonly profileService: SemanticEmbeddingProfilePort;
  readonly source: SemanticCorpusSourceSnapshotReaderPort;
  readonly activeGenerationReader: SemanticActiveGenerationReaderPort;
  readonly refresh: SemanticProjectionRefreshPort;
  readonly semanticEmbeddingResolver: SemanticEmbeddingResolverPort;
  readonly now?: () => string;
};

const configuredProfile = (profile: SemanticEmbeddingProfile | undefined): boolean =>
  profile !== undefined && (profile.status === 'PREPARED' || profile.status === 'ACTIVE');

const safeFailureCode = (
  error: unknown,
): SemanticProjectionConvergenceResult['safeFailureCode'] => {
  if (error instanceof SemanticEmbeddingError) {
    switch (error.embeddingErrorCode) {
      case 'CONFIGURATION_REQUIRED':
        return 'CONFIGURATION_REQUIRED';
      case 'CAPABILITY_UNAVAILABLE':
        return 'CAPABILITY_UNAVAILABLE';
      case 'POLICY_DENIED':
        return 'POLICY_DENIED';
      case 'PROVIDER_FAILURE':
        return 'PROVIDER_FAILURE';
      case 'CONFLICT':
        return 'CONFLICT';
      case 'STALE':
        return 'STALE';
      default:
        return 'UNKNOWN';
    }
  }
  return 'UNKNOWN';
};

const isRetryableConvergenceError = (error: unknown): boolean => {
  if (!(error instanceof SemanticEmbeddingError)) return true;
  return (
    error.retryable ||
    error.embeddingErrorCode === 'PROVIDER_FAILURE' ||
    error.embeddingErrorCode === 'CAPABILITY_UNAVAILABLE' ||
    error.embeddingErrorCode === 'TIMEOUT' ||
    error.embeddingErrorCode === 'STALE' ||
    error.embeddingErrorCode === 'CONFLICT'
  );
};

const requiredContext = (
  envelope: EventEnvelope<CanonicalCommittedPayload>,
): SemanticProjectionConvergenceInput => {
  if (!envelope.projectId || !envelope.actor || !envelope.security) {
    throw new SemanticEmbeddingError({
      code: 'POLICY_DENIED',
      safeMessage: 'Canonical convergence requires trusted project and security context.',
      operation: 'semantic-convergence:event-context',
      correlationId: envelope.correlationId,
    });
  }
  return {
    projectId: envelope.projectId,
    actor: envelope.actor,
    security: envelope.security,
    trigger: 'EVENT',
  };
};

/**
 * Coordinates CanonicalCommitted delivery with the existing generation
 * builder through SemanticProjectionRefreshPort. It owns no semantic data and
 * does not create a second refresh authority.
 */
export class SemanticProjectionConvergenceCoordinator implements SemanticProjectionConvergencePort {
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly observationsByProject = new Map<
    string,
    SemanticProjectionConvergenceObservation
  >();
  private readonly now: () => string;

  constructor(private readonly dependencies: ConvergenceDependencies) {
    this.now = dependencies.now ?? (() => new Date().toISOString());
  }

  observations(): readonly SemanticProjectionConvergenceObservation[] {
    return [...this.observationsByProject.values()]
      .sort((left, right) => left.projectId.localeCompare(right.projectId))
      .map((observation) => ({ ...observation }));
  }

  async converge(
    input: SemanticProjectionConvergenceInput,
  ): Promise<SemanticProjectionConvergenceResult> {
    const projectId = input.projectId.trim();
    if (!projectId) {
      throw new SemanticEmbeddingError({
        code: 'INVALID_INPUT',
        safeMessage: 'Project ID is required for semantic convergence.',
        operation: 'semantic-convergence:validate-project',
      });
    }

    const previous = this.locks.get(projectId);
    const current = (previous ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => this.convergeExclusive({ ...input, projectId }));
    this.locks.set(projectId, current);
    try {
      return await current;
    } finally {
      if (this.locks.get(projectId) === current) this.locks.delete(projectId);
    }
  }

  private async convergeExclusive(
    input: SemanticProjectionConvergenceInput,
  ): Promise<SemanticProjectionConvergenceResult> {
    let profile: SemanticEmbeddingProfile | undefined;
    try {
      profile = await this.dependencies.profileService.getCurrent(input.projectId);
    } catch (error) {
      this.record(input.projectId, {
        action: 'RECOVERY_PENDING',
        status: 'RECOVERY_PENDING',
        safeFailureCode: safeFailureCode(error),
      });
      throw error;
    }
    if (!profile) {
      return this.record(input.projectId, {
        action: 'NOT_CONFIGURED',
        status: 'NOT_CONFIGURED',
      });
    }

    if (!configuredProfile(profile)) {
      this.record(input.projectId, {
        action: 'DEGRADED',
        status: 'DEGRADED',
        profileRevision: profile.profileRevision,
        safeFailureCode: 'CONFIGURATION_REQUIRED',
      });
      throw new SemanticEmbeddingError({
        code: 'CONFIGURATION_REQUIRED',
        safeMessage: 'The current semantic embedding profile is not refreshable.',
        operation: 'semantic-convergence:profile-status',
      });
    }

    let watermark: Awaited<ReturnType<SemanticCorpusSourceSnapshotReaderPort['readWatermark']>>;
    let snapshot: Awaited<ReturnType<SemanticCorpusSourceSnapshotReaderPort['readSnapshot']>>;
    let active: Awaited<ReturnType<SemanticActiveGenerationReaderPort['getActiveGeneration']>>;
    try {
      watermark = await this.dependencies.source.readWatermark(input.projectId);
      snapshot = await this.dependencies.source.readSnapshot(input.projectId);
      active = await this.dependencies.activeGenerationReader.getActiveGeneration(input.projectId);
    } catch (error) {
      const code = safeFailureCode(error);
      this.record(input.projectId, {
        action: 'RECOVERY_PENDING',
        status: 'RECOVERY_PENDING',
        profileRevision: profile.profileRevision,
        safeFailureCode: code,
      });
      throw error;
    }
    const currentGeneration =
      active !== undefined &&
      active.buildStatus === 'READY' &&
      semanticGenerationMatchesSourceWatermark(active, watermark, input.projectId) &&
      (await semanticGenerationMatchesCurrentExecution({
        generation: active,
        profile,
        resolver: this.dependencies.semanticEmbeddingResolver,
        sensitivity: semanticSourceSensitivity(snapshot),
      }));

    if (currentGeneration && active) {
      return this.record(input.projectId, {
        action: 'NO_OP',
        status: 'READY',
        generationId: active.generationId,
        profileRevision: profile.profileRevision,
        canonicalVersion: watermark.canonicalVersion,
      });
    }

    this.record(input.projectId, {
      action: 'RECOVERY_PENDING',
      status: 'STALE',
      generationId: active?.generationId,
      profileRevision: profile.profileRevision,
      canonicalVersion: watermark.canonicalVersion,
      safeFailureCode: 'STALE',
    });

    try {
      const refreshed = await this.dependencies.refresh.refresh({
        projectId: input.projectId,
        actor: input.actor,
        security: input.security,
      });
      if (refreshed.status !== 'ACTIVATED') {
        return this.failRefresh({
          projectId: input.projectId,
          profileRevision: profile.profileRevision,
          canonicalVersion: watermark.canonicalVersion,
          safeFailureCode: refreshed.status === 'STALE' ? 'STALE' : 'CONFLICT',
        });
      }

      const converged = await this.dependencies.activeGenerationReader.getActiveGeneration(
        input.projectId,
      );
      const postRefreshWatermark = await this.dependencies.source.readWatermark(input.projectId);
      const postRefreshSnapshot = await this.dependencies.source.readSnapshot(input.projectId);
      if (
        !converged ||
        converged.buildStatus !== 'READY' ||
        !semanticGenerationMatchesSourceWatermark(
          converged,
          postRefreshWatermark,
          input.projectId,
        ) ||
        !(await semanticGenerationMatchesCurrentExecution({
          generation: converged,
          profile,
          resolver: this.dependencies.semanticEmbeddingResolver,
          sensitivity: semanticSourceSensitivity(postRefreshSnapshot),
        }))
      ) {
        return this.failRefresh({
          projectId: input.projectId,
          profileRevision: profile.profileRevision,
          canonicalVersion: postRefreshWatermark.canonicalVersion,
          safeFailureCode: 'STALE',
        });
      }

      return this.record(input.projectId, {
        action: 'REFRESHED',
        status: 'READY',
        generationId: converged.generationId,
        profileRevision: profile.profileRevision,
        canonicalVersion: postRefreshWatermark.canonicalVersion,
      });
    } catch (error) {
      const code = safeFailureCode(error);
      this.record(input.projectId, {
        action: isRetryableConvergenceError(error) ? 'RECOVERY_PENDING' : 'DEGRADED',
        status: isRetryableConvergenceError(error) ? 'RECOVERY_PENDING' : 'DEGRADED',
        profileRevision: profile.profileRevision,
        canonicalVersion: watermark.canonicalVersion,
        safeFailureCode: code,
      });
      throw error;
    }
  }

  private failRefresh(input: {
    readonly projectId: string;
    readonly profileRevision: number;
    readonly canonicalVersion: number;
    readonly safeFailureCode: 'STALE' | 'CONFLICT';
  }): never {
    this.record(input.projectId, {
      action: 'RECOVERY_PENDING',
      status: 'RECOVERY_PENDING',
      profileRevision: input.profileRevision,
      canonicalVersion: input.canonicalVersion,
      safeFailureCode: input.safeFailureCode,
    });
    throw new SemanticEmbeddingError({
      code: input.safeFailureCode,
      safeMessage: 'Semantic projection convergence remains pending.',
      operation: 'semantic-convergence:refresh',
      retryable: true,
    });
  }

  private record(
    projectId: string,
    input: Omit<SemanticProjectionConvergenceObservation, 'projectId' | 'observedAt'>,
  ): SemanticProjectionConvergenceResult {
    const observation: SemanticProjectionConvergenceObservation = {
      projectId,
      ...input,
      observedAt: this.now(),
    };
    this.observationsByProject.set(projectId, observation);
    return {
      projectId,
      action: observation.action,
      ...(observation.generationId === undefined ? {} : { generationId: observation.generationId }),
      ...(observation.profileRevision === undefined
        ? {}
        : { profileRevision: observation.profileRevision }),
      ...(observation.canonicalVersion === undefined
        ? {}
        : { canonicalVersion: observation.canonicalVersion }),
      ...(observation.safeFailureCode === undefined
        ? {}
        : { safeFailureCode: observation.safeFailureCode }),
    };
  }
}

const noOpConvergence: SemanticProjectionConvergencePort = {
  async converge(input) {
    return { projectId: input.projectId, action: 'NOT_CONFIGURED' };
  },
};

export const createSemanticProjectionConvergenceModule = (
  convergence?: SemanticProjectionConvergencePort,
): ShotgunModule => ({
  manifest: {
    id: 'stage7.semantic-projection-convergence',
    version: '1.0.0',
    owner: 'Shotgun Semantic Projection Convergence',
    compatibility: {
      runtime: '>=1.0.0 <2.0.0',
      contracts: [{ name: 'CanonicalCommitted', range: '>=1.0.0 <2.0.0' }],
    },
    deployment: { modes: ['in_process', 'worker'] },
    dataOwnership: {
      owns: [],
      readsViaPorts: [
        'SemanticCorpusSourceSnapshotReaderPort',
        'SemanticActiveGenerationReaderPort',
        'SemanticEmbeddingProfilePort',
        'SemanticEmbeddingResolverPort',
        'SemanticProjectionRefreshPort',
      ],
      directSchemaAccess: false,
    },
    consumes: {
      commands: [],
      events: [{ name: 'CanonicalCommitted', range: '>=1.0.0 <2.0.0' }],
    },
    produces: { events: [], handoffs: [] },
    provides: { queries: [], capabilities: [] },
    requires: { capabilities: [] },
    security: {
      requiredContext: ['actor', 'project', 'access_scope', 'sensitivity'],
      defaultOnMissingContext: 'deny',
    },
    approvalPolicy: { canWriteCanonical: false, canExecuteExternalAction: false },
  },
  contracts: [
    {
      name: 'CanonicalCommitted',
      version: '1.0.0',
      kind: 'event',
      inputSchema: canonicalCommittedSchema,
    },
  ],
  handlers: {
    commands: [],
    events: [
      {
        messageType: 'CanonicalCommitted',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        // Convergence is durable and independently replayable, but a provider
        // outage must never prevent Canonical outbox acknowledgement.
        async handle(envelope): Promise<void> {
          await (convergence ?? noOpConvergence).converge(
            requiredContext(envelope as EventEnvelope<CanonicalCommittedPayload>),
          );
        },
      },
    ],
    queries: [],
  },
});

export type SemanticProjectionConvergenceRecoveryProjectResult = {
  readonly projectId: string;
  readonly status: 'READY' | 'NOT_CONFIGURED' | 'RECOVERY_PENDING' | 'DEGRADED';
  readonly action: SemanticProjectionConvergenceAction;
  readonly generationId?: string;
  readonly safeFailureCode?: SemanticProjectionConvergenceResult['safeFailureCode'];
};

export type SemanticProjectionConvergenceRecoveryResult = {
  readonly projects: readonly SemanticProjectionConvergenceRecoveryProjectResult[];
  readonly ready: number;
  readonly notConfigured: number;
  readonly recoveryPending: number;
  readonly degraded: number;
};

const recoveryContext = (projectId: string): SemanticProjectionConvergenceInput => ({
  projectId,
  actor: { type: 'service', id: 'stage7-semantic-projection-convergence-recovery' },
  security: {
    accessScope: ['owner'],
    sensitivity: 'restricted',
    dataClassification: 'semantic-projection-recovery',
  },
  trigger: 'STARTUP',
});

/**
 * Bounded reconciliation for Canonical commits whose outbox event was already
 * published before a process restart. It scans only existing Canonical project
 * identities and never mutates Canonical or replays an approval.
 */
export const runSemanticProjectionConvergenceRecovery = async (
  listProjectIds: () => Promise<readonly string[]>,
  convergence: SemanticProjectionConvergencePort,
  trigger: Exclude<SemanticProjectionConvergenceTrigger, 'EVENT'> = 'STARTUP',
): Promise<SemanticProjectionConvergenceRecoveryResult> => {
  const projects: SemanticProjectionConvergenceRecoveryProjectResult[] = [];
  for (const projectId of await listProjectIds()) {
    try {
      const result = await convergence.converge({
        ...recoveryContext(projectId),
        trigger,
      });
      const status =
        result.action === 'NOT_CONFIGURED'
          ? 'NOT_CONFIGURED'
          : result.action === 'NO_OP' || result.action === 'REFRESHED'
            ? 'READY'
            : result.action === 'RECOVERY_PENDING'
              ? 'RECOVERY_PENDING'
              : 'DEGRADED';
      projects.push({
        projectId,
        status,
        action: result.action,
        ...(result.generationId === undefined ? {} : { generationId: result.generationId }),
        ...(result.safeFailureCode === undefined
          ? {}
          : { safeFailureCode: result.safeFailureCode }),
      });
    } catch (error) {
      projects.push({
        projectId,
        status: 'RECOVERY_PENDING',
        action: 'RECOVERY_PENDING',
        safeFailureCode: safeFailureCode(error),
      });
    }
  }
  return {
    projects,
    ready: projects.filter((project) => project.status === 'READY').length,
    notConfigured: projects.filter((project) => project.status === 'NOT_CONFIGURED').length,
    recoveryPending: projects.filter((project) => project.status === 'RECOVERY_PENDING').length,
    degraded: projects.filter((project) => project.status === 'DEGRADED').length,
  };
};

export type SemanticProjectionConvergenceWorkerOptions = {
  /**
   * Run one bounded STARTUP reconciliation immediately after the worker is
   * created. The tick is deliberately fire-and-contained: application
   * readiness must not wait for an external embedding provider.
   */
  readonly startImmediately?: boolean;
  readonly onResult?: (
    result: SemanticProjectionConvergenceRecoveryResult,
    startedAt: string,
    completedAt: string,
  ) => void | Promise<void>;
  readonly onFailure?: (startedAt: string, completedAt: string) => void | Promise<void>;
};

export const startSemanticProjectionConvergenceWorker = (
  listProjectIds: () => Promise<readonly string[]>,
  convergence: SemanticProjectionConvergencePort,
  intervalMs: number,
  options: SemanticProjectionConvergenceWorkerOptions = {},
) => {
  if (!Number.isFinite(intervalMs) || intervalMs < 1) {
    throw new RangeError('Semantic convergence interval must be at least one millisecond.');
  }
  let active: Promise<void> | undefined;
  let stopped = false;
  const tick = (
    trigger: Exclude<SemanticProjectionConvergenceTrigger, 'EVENT'> = 'PERIODIC',
  ): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (active) return active;
    const startedAt = new Date().toISOString();
    const reportFailure = async (): Promise<void> => {
      try {
        await options.onFailure?.(startedAt, new Date().toISOString());
      } catch {
        // Recovery reporting is best effort and must not create an
        // unhandled rejection in the background interval.
      }
    };
    const execution = runSemanticProjectionConvergenceRecovery(listProjectIds, convergence, trigger)
      .then(async (result) => {
        try {
          await options.onResult?.(result, startedAt, new Date().toISOString());
        } catch {
          await reportFailure();
        }
      })
      .catch(() => reportFailure())
      .then(() => undefined)
      .finally(() => {
        if (active === execution) active = undefined;
      });
    active = execution;
    return execution;
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  if (options.startImmediately) {
    // tick() contains the full rejection boundary, including best-effort
    // recovery reporting. Keeping the promise internally tracked also lets
    // stop() await an in-flight startup reconciliation.
    void tick('STARTUP');
  }
  return {
    tick,
    async stop() {
      stopped = true;
      clearInterval(timer);
      await active;
    },
  };
};
