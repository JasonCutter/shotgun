import type {
  DiscoveryAttemptV1,
  DiscoveryJobV1,
  DiscoveryLogicalJobIdentityV1,
  DiscoveryProjectionWaitBindingV1,
  DiscoveryRunV1,
  DiscoveryRuntimeLifecycleStateV1,
  DiscoveryRuntimeStageStateV1,
  DiscoveryStageV1,
} from '../../../packages/contracts/src/index.js';

export type DiscoveryRuntimeJobLookupV1 = {
  readonly projectId: string;
  readonly jobId: string;
};

export type DiscoveryRuntimeLogicalJobLookupV1 = {
  readonly projectId: string;
  readonly logicalIdentity: DiscoveryLogicalJobIdentityV1;
};

export type DiscoveryRuntimeJobTransitionInputV1 = DiscoveryRuntimeJobLookupV1 & {
  readonly expectedLifecycleRevision: number;
  readonly targetState: DiscoveryRuntimeLifecycleStateV1;
  readonly projectionWait?: DiscoveryProjectionWaitBindingV1;
  readonly updatedAt: string;
};

export type DiscoveryRuntimeRunLookupV1 = DiscoveryRuntimeJobLookupV1 & {
  readonly runId: string;
};

export type DiscoveryRuntimeRunTransitionInputV1 = DiscoveryRuntimeRunLookupV1 & {
  readonly expectedLifecycleRevision: number;
  readonly targetState: DiscoveryRuntimeLifecycleStateV1;
  readonly projectionWait?: DiscoveryProjectionWaitBindingV1;
  readonly updatedAt: string;
  readonly completedAt?: string;
};

export type DiscoveryRuntimeStageLookupV1 = {
  readonly projectId: string;
  readonly runId: string;
  readonly attemptId: string;
};

export type DiscoveryRuntimeAttemptLookupV1 = DiscoveryRuntimeRunLookupV1 & {
  readonly attemptId: string;
};

export type DiscoveryRuntimeAttemptTransitionInputV1 = DiscoveryRuntimeAttemptLookupV1 & {
  readonly expectedLifecycleRevision: number;
  readonly targetState: DiscoveryRuntimeLifecycleStateV1;
  readonly updatedAt: string;
  readonly completedAt?: string;
};

export type DiscoveryRuntimeStageTransitionInputV1 = DiscoveryRuntimeStageLookupV1 & {
  readonly stageId: string;
  readonly expectedStageRevision: number;
  readonly targetState: DiscoveryRuntimeStageStateV1;
  readonly updatedAt: string;
  readonly completedAt?: string;
};

export type DiscoveryRuntimeRepositoryPort = {
  saveJob(job: DiscoveryJobV1): Promise<'CREATED' | 'CONFLICT'>;
  findJob(lookup: DiscoveryRuntimeJobLookupV1): Promise<DiscoveryJobV1 | undefined>;
  findJobByLogicalIdentity(
    lookup: DiscoveryRuntimeLogicalJobLookupV1,
  ): Promise<DiscoveryJobV1 | undefined>;
  transitionJob(
    input: DiscoveryRuntimeJobTransitionInputV1,
  ): Promise<DiscoveryJobV1 | 'NOT_FOUND' | 'CONFLICT'>;

  saveRun(run: DiscoveryRunV1): Promise<'CREATED' | 'CONFLICT'>;
  findRun(lookup: DiscoveryRuntimeRunLookupV1): Promise<DiscoveryRunV1 | undefined>;
  transitionRun(
    input: DiscoveryRuntimeRunTransitionInputV1,
  ): Promise<DiscoveryRunV1 | 'NOT_FOUND' | 'CONFLICT'>;

  saveAttempt(attempt: DiscoveryAttemptV1): Promise<'CREATED' | 'CONFLICT'>;
  listAttempts(lookup: DiscoveryRuntimeRunLookupV1): Promise<readonly DiscoveryAttemptV1[]>;
  transitionAttempt(
    input: DiscoveryRuntimeAttemptTransitionInputV1,
  ): Promise<DiscoveryAttemptV1 | 'NOT_FOUND' | 'CONFLICT'>;

  saveStage(stage: DiscoveryStageV1): Promise<'CREATED' | 'CONFLICT'>;
  listStages(lookup: DiscoveryRuntimeStageLookupV1): Promise<readonly DiscoveryStageV1[]>;
  transitionStage(
    input: DiscoveryRuntimeStageTransitionInputV1,
  ): Promise<DiscoveryStageV1 | 'NOT_FOUND' | 'CONFLICT'>;
};
