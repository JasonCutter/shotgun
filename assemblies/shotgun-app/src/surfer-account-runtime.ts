import type { Pool } from 'pg';
import type { ProjectAIConfigurationPort } from '../../../modules/ai-configuration/src/index.js';
import type { CredentialVaultPort } from '../../../modules/credential-vault/src/index.js';
import type { AIProviderExecutionResolverPort } from '../../../modules/ai-provider/src/index.js';
import type {
  SurferGenerationRequest,
  SurferProviderGatewayPort,
} from '../../../packages/contracts/src/surfer-provider.js';
import { SurferProviderNotSentError } from '../../../packages/contracts/src/surfer-provider.js';
import type { SurferReadinessState } from '../../../packages/contracts/src/surfer-readiness.js';
import type { SurferExecutionPolicy } from '../../../packages/contracts/src/surfer-execution.js';
import {
  decodeSurferExecutionPolicy,
  SURFER_USAGE_KEYS,
} from '../../../packages/contracts/src/surfer-execution.js';
import { decodeSurferAccountAuthorityConfigV2 } from '../../../packages/contracts/src/surfer-account-authority-v2.js';
import { decodeSurferSourceRequest } from '../../../packages/contracts/src/surfer-source.js';
import { surferDigest, surferFailure } from '../../../packages/contracts/src/surfer-learning.js';
import { ShotgunError } from '../../../packages/contracts/src/errors.js';
import {
  surferAccountAuthorityFromConfig,
  type PostgresSurferAccountAuthority,
} from '../../../adapters/surfer-account-authority-postgres/src/index.js';
import { PostgresSurferExecutionStore } from '../../../adapters/surfer-execution-postgres/src/index.js';
import { PostgresSurferSourceSession } from '../../../adapters/surfer-shotgun-source-postgres/src/index.js';
import { ShotgunSurferProviderGateway } from '../../../adapters/surfer-shotgun-bridge/src/provider.js';
import { SurferExecutionLedger } from '../../../modules/surfer-execution/src/index.js';
import type { SurferDocumentExecutionOptions } from './surfer-runtime.js';
import type { SurferIntakeScheduleOptions } from './surfer-intake-scheduler.js';
export type SurferAccountApplicationOptions = SurferIntakeScheduleOptions & {
  readonly projectId: string;
  readonly runId: string;
  readonly accountConfig: unknown;
  readonly policy: SurferExecutionPolicy;
  readonly authorityDatabaseUrl: string;
  readonly inputBound: {
    readonly revision: string;
    upperBound(request: SurferGenerationRequest): number;
  };
};
type Services = {
  workloadDatabaseUrl: string;
  resolver: AIProviderExecutionResolverPort;
  configuration: Pick<ProjectAIConfigurationPort, 'getCurrent'>;
  vault: Pick<CredentialVaultPort, 'getMetadata'>;
};
const denied = () =>
  new ShotgunError({
    code: 'POLICY_DENIED',
    safeMessage: 'The fixed Surfer execution binding is not currently available.',
    module: 'surfer.application',
    operation: 'account-binding',
  });
/** Explicit server config only. No env lookup, key creation, registration or grant at construction. */
export function createSurferAccountRuntime(
  pool: Pool,
  options: SurferAccountApplicationOptions,
  services: Services,
) {
  const config = decodeSurferAccountAuthorityConfigV2(options.accountConfig),
    profile = config.profile,
    policy = decodeSurferExecutionPolicy(options.policy);
  const { projectId, runId } = options;
  if (
    typeof projectId !== 'string' ||
    !projectId.length ||
    projectId.length > 256 ||
    !/^[A-Za-z0-9-]{1,40}$/.test(runId) ||
    config.rootPolicy.schemaVersion !== '1.1.0' ||
    config.rootPolicy.dailyCallLimit !== null ||
    policy.allowedSpaceIds.length !== 1 ||
    policy.allowedSpaceIds[0] !== projectId ||
    policy.executionIdentity !== surferDigest(profile.identity) ||
    policy.modelRevision !== `${profile.identity.providerId}/${profile.identity.modelId}` ||
    policy.egressPolicyRevision !== profile.egressPolicyRevision ||
    policy.pricingRevision !== profile.pricingRevision ||
    policy.currency !== profile.currency ||
    policy.deadlineAtMs > config.rootPolicy.expiresAtMs ||
    policy.unitMaxMs < profile.maximum.elapsedMs ||
    SURFER_USAGE_KEYS.some((k) => profile.maximum[k] > policy.limits[k]) ||
    options.inputBound.revision !== profile.inputBoundRevision ||
    typeof options.inputBound.upperBound !== 'function'
  )
    throw surferFailure('Invalid fixed native Surfer execution configuration.');
  const bound = {
    revision: options.inputBound.revision,
    upperBound: options.inputBound.upperBound,
  };
  const ledger = new SurferExecutionLedger(new PostgresSurferExecutionStore(pool), policy);
  const account = surferAccountAuthorityFromConfig({
    workloadDatabaseUrl: services.workloadDatabaseUrl,
    authorityDatabaseUrl: options.authorityDatabaseUrl,
    config,
  });
  const authority: PostgresSurferAccountAuthority = account.authority;
  const source = new PostgresSurferSourceSession(pool);
  let closed = false,
    closing: Promise<void> | undefined;
  const probe = async (): Promise<SurferReadinessState> => {
    if (closed) return 'UNAVAILABLE';
    if (Date.now() >= policy.deadlineAtMs) return 'RUN_EXPIRED';
    const current = await services.configuration.getCurrent(projectId),
      i = profile.identity;
    if (
      !current ||
      current.projectId !== projectId ||
      current.activeProviderId !== i.providerId ||
      current.activeModelId !== i.modelId ||
      current.aiConfigurationRevision !== i.aiConfigurationRevision ||
      current.credentialId !== i.credentialId ||
      current.credentialRevision !== i.credentialRevision
    )
      return 'CONFIGURATION_CHANGED';
    const metadata = await services.vault.getMetadata({
      projectId,
      providerId: i.providerId,
      credentialId: i.credentialId,
      credentialRevision: i.credentialRevision,
    });
    if (
      !metadata ||
      metadata.projectId !== projectId ||
      metadata.providerId !== i.providerId ||
      metadata.credentialId !== i.credentialId ||
      metadata.credentialRevision !== i.credentialRevision ||
      metadata.lifecycleState !== 'active'
    )
      return 'CREDENTIAL_UNAVAILABLE';
    if (!(await authority.isCurrent(projectId))) return 'ACCOUNT_REVIEW_REQUIRED';
    if (closed) return 'UNAVAILABLE';
    if (Date.now() >= policy.deadlineAtMs) return 'RUN_EXPIRED';
    return 'PROFILE_CONNECTED';
  };
  const authorizeOwner = async (actor: unknown) => {
    if (closed) throw denied();
    const request = decodeSurferSourceRequest(actor);
    if (request.projectId !== projectId) return false;
    await source.withMetadataSnapshot(request, async (snapshot) => {
      if (!snapshot.canSynchronize) throw denied();
    });
    return true;
  };
  const check = async () => {
    if ((await probe()) !== 'PROFILE_CONNECTED') throw denied();
  };
  const ensureCurrent = async (actor: unknown) => {
    if (!(await authorizeOwner(actor))) throw denied();
    await check();
  };
  const native = new ShotgunSurferProviderGateway(
    services.resolver,
    profile,
    account.authority,
    bound,
  );
  const gateway: SurferProviderGatewayPort = {
    prepare: async (binding, request) => {
      if (binding.projectId !== projectId) throw denied();
      await check();
      const prepared = await native.prepare(binding, request);
      return {
        ...prepared,
        generate: async (signal) => {
          try {
            await check();
          } catch {
            prepared.discard();
            throw new SurferProviderNotSentError();
          }
          return prepared.generate(signal);
        },
      };
    },
    reconcile: (...args) => native.reconcile(...args),
  };
  const execution: SurferDocumentExecutionOptions = {
    runId,
    profile,
    ledger,
    gateway,
    ensureCurrent,
    inspectReadiness: async (actor) => ((await authorizeOwner(actor)) ? probe() : 'NOT_CONFIGURED'),
  };
  return {
    execution,
    resolveActor: options.resolveActor,
    intervalMs: options.intervalMs,
    maxCyclesPerTick: options.maxCyclesPerTick,
    close: () => {
      closed = true;
      return (closing ??= account.close());
    },
  };
}
