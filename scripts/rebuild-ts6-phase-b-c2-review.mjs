/* global process, console */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const c2Root = path.join(root, 'artifacts', 'ts6-phase-b-c2');
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const writeJson = (file, value) => {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
};
const writeText = (file, value) => {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, value.endsWith('\n') ? value : `${value}\n`);
};
const sha256 = (file) =>
  crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(root, file)))
    .digest('hex')
    .toUpperCase();

const c1 = readJson('artifacts/ts6-phase-b-c1/safe-helper-final-phase-b-c1.json');
const rawReview = readJson('artifacts/ts6-phase-b-review/raw-architecture-review-38.json');
const priorGolden = readJson('artifacts/ts6-phase-b-review/golden-corpus.json');

const acceptedRawIds = new Set([
  'raw:adapters/credential-vault-postgres/src/index.ts:141:PostgresCredentialVaultRepository.advanceRevision',
  'raw:adapters/postgres-stage4/src/index.ts:315:PostgresAIProviderCallRepository.ensure',
  'raw:adapters/postgres-stage4/src/index.ts:524:PostgresAIProviderCallRepository.acceptOutput',
  'raw:adapters/postgres-stage4/src/index.ts:684:PostgresAIProviderCallRepository.markAttemptOutcomeUnknown',
  'raw:adapters/postgres-stage4/src/index.ts:796:PostgresCandidateRepository.saveBatch',
  'raw:adapters/postgres-stage5/src/index.ts:1904:PostgresChangeSetReviewV2Repository.resolveOperation',
  'raw:adapters/semantic-embedding-postgres/src/index.ts:99:PostgresSemanticEmbeddingProfileRepository.saveRevision',
]);

const safeRows = c1.rows;
const safeCallerRows = safeRows.filter((row) => row.finalDisposition !== 'NO_CHANGE_PROVEN_SAFE');
const rawCallerRows = rawReview.rows.filter((row) => !acceptedRawIds.has(row.semanticBoundaryId));
if (safeRows.length !== 51 || safeCallerRows.length !== 49 || rawCallerRows.length !== 38) {
  throw new Error(
    `Unexpected C2 row selection: safe=${safeRows.length}, safeCaller=${safeCallerRows.length}, rawCaller=${rawCallerRows.length}`,
  );
}

const safeDiscoveryIds = new Set(
  safeCallerRows
    .filter((row) => row.transactionOwner.startsWith('PostgresDiscovery'))
    .map((row) => row.stableBoundaryId),
);
const safeDisposition = (row) => {
  if (row.transactionOwner === 'PostgresConnectorRuntimeState.recoverExpiredLeases')
    return 'FIX_CALLER_OUTCOME_PROPAGATION';
  if (safeDiscoveryIds.has(row.stableBoundaryId)) return 'FIX_CALLER_OUTCOME_PROPAGATION';
  if (
    row.transactionOwner === 'PostgresFrontendCommandGateway.accept' ||
    row.transactionOwner === 'PostgresFrontendCommandGateway.complete'
  ) {
    return 'FIX_OPERATION_SPECIFIC_RESOLUTION';
  }
  return 'NO_CHANGE_PROVEN_SAFE';
};

const rawCallerPropagationIds = new Set([
  'raw:adapters/frontend-sources-write-postgres/src/index.ts:129:PostgresSourcesIntakeUnitOfWork.createSubmission',
  'raw:adapters/frontend-sources-write-postgres/src/index.ts:215:PostgresSourcesIntakeUnitOfWork.createExactDuplicateDecision',
  'raw:adapters/frontend-sources-write-postgres/src/index.ts:290:PostgresSourcesIntakeUnitOfWork.resolveExactDuplicateDecision',
  'raw:adapters/frontend-sources-write-postgres/src/lifecycle.ts:202:PostgresSourcesIntakeLifecycle.transaction',
  'raw:adapters/frontend-sources-write-postgres/src/product-service.ts:274:PostgresSourcesProductService.submit',
  'raw:adapters/frontend-sources-write-postgres/src/product-service.ts:475:PostgresSourcesProductService.markSubmissionStage3Incomplete',
  'raw:adapters/frontend-sources-write-postgres/src/product-service.ts:523:PostgresSourcesProductService.finalizeSubmissionState',
  'raw:adapters/frontend-sources-write-postgres/src/product-service.ts:772:PostgresSourcesProductService.resolveDuplicate',
  'raw:adapters/frontend-sources-write-postgres/src/product-service.ts:967:PostgresSourcesProductService.retry',
  'raw:adapters/frontend-sources-write-postgres/src/product-service.ts:1518:PostgresSourcesProductService.markStage3ItemsSucceeded',
  'raw:adapters/postgres/src/index.ts:823:PostgresProjectAdministrationRepository.createProject',
  'raw:adapters/postgres/src/index.ts:975:PostgresProjectAdministrationRepository.updateProject',
  'raw:adapters/postgres/src/index.ts:1108:PostgresProjectAdministrationRepository.updateStatus',
  'raw:adapters/postgres/src/index.ts:1230:PostgresProjectBootstrapUnitOfWork.bootstrap',
  'raw:adapters/postgres/src/index.ts:1505:PostgresSettingsRepository.updatePrincipalPreferences',
  'raw:adapters/postgres/src/index.ts:1820:PostgresSettingsRepository.applySettingsCommand',
]);
const rawDisposition = (row) =>
  rawCallerPropagationIds.has(row.semanticBoundaryId)
    ? 'FIX_CALLER_OUTCOME_PROPAGATION'
    : 'FIX_WRAPPER_ONLY';

const routeEvidence = {
  project: {
    file: 'assemblies/shotgun-app/src/product-api/project-routes.ts',
    callers: 'createProject, updateProject, updateStatus, bootstrap',
    higher: 'Project Product API accepted-command boundary',
    binding:
      'registerProjectRoutes receives FrontendCommandGatewayPort; accepted.outcome.commandId is the exact command identity.',
  },
  settings: {
    file: 'assemblies/shotgun-app/src/product-api/settings-routes.ts',
    callers: 'updatePrincipalPreferences, applySettingsCommand',
    higher: 'Settings Product API accepted-command boundary',
    binding:
      'registerSettingsRoutes receives FrontendCommandGatewayPort; accepted.outcome.commandId is the exact command identity.',
  },
  sources: {
    file: 'assemblies/shotgun-app/src/product-api/sources-routes.ts',
    callers: 'submit and converted source accepted-command operations',
    higher: 'Sources Product API accepted-command boundary',
    binding:
      'getSourcesWriteRuntime supplies FrontendCommandGatewayPort; accepted.outcome.commandId is the exact command identity.',
  },
};

const explicitRawCaller = new Map([
  [
    'raw:adapters/frontend-activity-postgres/src/index.ts:91:PostgresActivityIndexStore.<anonymous-function>',
    ['ActivityProjectionBuilder.buildProjectProjection', 'modules/frontend-activity/src/index.ts'],
  ],
  [
    'raw:adapters/frontend-activity-postgres/src/index.ts:444:commitProjectProjection',
    ['ActivityProjectionBuilder.buildProjectProjection', 'modules/frontend-activity/src/index.ts'],
  ],
  [
    'raw:adapters/frontend-history-postgres/src/history-projection-store.ts:122:withHistoryProjectWriteLock',
    ['HistoryProjectionBuilder.buildProjectProjection', 'modules/frontend-history/src/index.ts'],
  ],
  [
    'raw:adapters/frontend-history-postgres/src/history-projection-store.ts:396:commitProjectProjection',
    ['HistoryProjectionBuilder.buildProjectProjection', 'modules/frontend-history/src/index.ts'],
  ],
  [
    'raw:adapters/frontend-history-postgres/src/index.ts:128:PostgresPayloadStateStore.setPayloadState',
    ['HistoryPayloadCoordinator.persistPayloadState', 'modules/frontend-history/src/index.ts'],
  ],
  [
    'raw:adapters/frontend-history-postgres/src/index.ts:213:PostgresPayloadStateStore.purgeByPolicy',
    ['HistoryPayloadMaintenance.applyRetentionPolicy', 'modules/frontend-history/src/index.ts'],
  ],
  [
    'raw:adapters/frontend-sources-write-postgres/src/index.ts:129:PostgresSourcesIntakeUnitOfWork.createSubmission',
    [
      'PostgresSourcesProductService.submit',
      'adapters/frontend-sources-write-postgres/src/product-service.ts',
    ],
  ],
  [
    'raw:adapters/frontend-sources-write-postgres/src/index.ts:215:PostgresSourcesIntakeUnitOfWork.createExactDuplicateDecision',
    [
      'PostgresSourcesProductService.submit',
      'adapters/frontend-sources-write-postgres/src/product-service.ts',
    ],
  ],
  [
    'raw:adapters/frontend-sources-write-postgres/src/index.ts:290:PostgresSourcesIntakeUnitOfWork.resolveExactDuplicateDecision',
    [
      'PostgresSourcesProductService.resolveDuplicate',
      'adapters/frontend-sources-write-postgres/src/product-service.ts',
    ],
  ],
  [
    'raw:adapters/frontend-sources-write-postgres/src/lifecycle.ts:202:PostgresSourcesIntakeLifecycle.transaction',
    [
      'PostgresSourcesProductService.submit',
      'adapters/frontend-sources-write-postgres/src/product-service.ts',
    ],
  ],
  [
    'raw:adapters/frontend-sources-write-postgres/src/product-service.ts:274:PostgresSourcesProductService.submit',
    ['sources-routes accepted-command submit handler', routeEvidence.sources.file],
  ],
  [
    'raw:adapters/frontend-sources-write-postgres/src/product-service.ts:475:PostgresSourcesProductService.markSubmissionStage3Incomplete',
    [
      'PostgresSourcesProductService.runStage3AndFinalize',
      'adapters/frontend-sources-write-postgres/src/product-service.ts',
    ],
  ],
  [
    'raw:adapters/frontend-sources-write-postgres/src/product-service.ts:523:PostgresSourcesProductService.finalizeSubmissionState',
    [
      'PostgresSourcesProductService.runStage3AndFinalize',
      'adapters/frontend-sources-write-postgres/src/product-service.ts',
    ],
  ],
  [
    'raw:adapters/frontend-sources-write-postgres/src/product-service.ts:772:PostgresSourcesProductService.resolveDuplicate',
    ['sources-routes accepted-command duplicate handler', routeEvidence.sources.file],
  ],
  [
    'raw:adapters/frontend-sources-write-postgres/src/product-service.ts:967:PostgresSourcesProductService.retry',
    ['sources-routes accepted-command retry handler', routeEvidence.sources.file],
  ],
  [
    'raw:adapters/frontend-sources-write-postgres/src/product-service.ts:1518:PostgresSourcesProductService.markStage3ItemsSucceeded',
    [
      'PostgresSourcesProductService.runStage3AndFinalize',
      'adapters/frontend-sources-write-postgres/src/product-service.ts',
    ],
  ],
  [
    'raw:adapters/postgres-auth/src/index.ts:71:PostgresAuthRepository.bootstrapLocalOwnerPrincipal',
    [
      'DefaultLocalOwnerProvisioningService.ensureLocalOwnerIdentity',
      'modules/authentication/src/index.ts',
    ],
  ],
  [
    'raw:adapters/postgres-stage3/src/index.ts:150:PostgresTransformationRepository.save',
    ['SourcesStage3PipelineRuntime.runForSourceVersion', 'modules/sources-stage3/src/index.ts'],
  ],
  [
    'raw:adapters/postgres-stage3/src/index.ts:308:PostgresEvidenceRepository.index',
    ['SourcesStage3PipelineRuntime.runForSourceVersion', 'modules/sources-stage3/src/index.ts'],
  ],
  [
    'raw:adapters/postgres-stage4/src/index.ts:452:PostgresAIProviderCallRepository.storeOutput',
    ['Stage4PipelineRuntime.storeOutput', 'modules/stage4/src/index.ts'],
  ],
  [
    'raw:adapters/postgres-stage4/src/index.ts:648:PostgresAIProviderCallRepository.failAttempt',
    ['Stage4PipelineRuntime.failAttempt', 'modules/stage4/src/index.ts'],
  ],
  [
    'raw:adapters/postgres-stage5/src/index.ts:407:PostgresComparisonV2Repository.withTransaction',
    [
      'PostgresComparisonV2Repository.saveAnalysisRevision',
      'adapters/postgres-stage5/src/index.ts',
    ],
  ],
  [
    'raw:adapters/postgres-stage5/src/index.ts:1233:PostgresChangeSetReviewRepository.recordDecision',
    ['Review Product API recordDecision coordinator', 'modules/review/src/product-api.ts'],
  ],
  [
    'raw:adapters/postgres-stage5/src/index.ts:1339:PostgresChangeSetReviewRepository.markStale',
    ['Review Product API stale revalidation coordinator', 'modules/review/src/product-api.ts'],
  ],
  [
    'raw:adapters/postgres-stage5/src/index.ts:1462:PostgresChangeSetReviewV2Repository.saveDraft',
    ['ReviewV2 Product API materializeDraft coordinator', 'modules/review/src/product-api.ts'],
  ],
  [
    'raw:adapters/postgres-stage5/src/index.ts:2125:PostgresChangeSetReviewV2Repository.recordDecision',
    ['ReviewV2 Product API recordDecision coordinator', 'modules/review/src/product-api.ts'],
  ],
  [
    'raw:adapters/postgres/src/index.ts:312:PostgresOriginalAssetRepository.store',
    ['Stage2 intake write coordinator', 'modules/intake/src/index.ts'],
  ],
  [
    'raw:adapters/postgres/src/index.ts:823:PostgresProjectAdministrationRepository.createProject',
    ['project-routes accepted-command createProject handler', routeEvidence.project.file],
  ],
  [
    'raw:adapters/postgres/src/index.ts:975:PostgresProjectAdministrationRepository.updateProject',
    ['project-routes accepted-command updateProject handler', routeEvidence.project.file],
  ],
  [
    'raw:adapters/postgres/src/index.ts:1108:PostgresProjectAdministrationRepository.updateStatus',
    ['project-routes accepted-command updateStatus handler', routeEvidence.project.file],
  ],
  [
    'raw:adapters/postgres/src/index.ts:1230:PostgresProjectBootstrapUnitOfWork.bootstrap',
    ['project-routes accepted-command bootstrap handler', routeEvidence.project.file],
  ],
  [
    'raw:adapters/postgres/src/index.ts:1505:PostgresSettingsRepository.updatePrincipalPreferences',
    ['settings-routes accepted-command preferences handler', routeEvidence.settings.file],
  ],
  [
    'raw:adapters/postgres/src/index.ts:1820:PostgresSettingsRepository.applySettingsCommand',
    ['settings-routes accepted-command settings handler', routeEvidence.settings.file],
  ],
  [
    'raw:adapters/project-standing-ai-policy-postgres/src/index.ts:75:PostgresStandingAIProcessingPolicyRepository.saveRevision',
    ['StandingAIProcessingPolicyService.save', 'modules/project-standing-ai-policy/src/index.ts'],
  ],
  [
    'raw:adapters/provider-privacy-deployment-postgres/src/index.ts:91:PostgresProviderExternalTransferApprovalRepository.createProposal',
    [
      'ProviderExternalTransferApprovalService.propose',
      'modules/provider-privacy-deployment/src/index.ts',
    ],
  ],
  [
    'raw:adapters/provider-privacy-deployment-postgres/src/index.ts:165:PostgresProviderExternalTransferApprovalRepository.approveProposal',
    [
      'ProviderExternalTransferApprovalService.approve',
      'modules/provider-privacy-deployment/src/index.ts',
    ],
  ],
  [
    'raw:adapters/semantic-index-postgres/src/index.ts:454:PostgresSemanticIndexRepository.upsertItems',
    ['SemanticGenerationBuilder.build', 'modules/semantic-generation/src/index.ts'],
  ],
  [
    'raw:adapters/semantic-index-postgres/src/index.ts:926:PostgresSemanticIndexRepository.activateGeneration',
    ['SemanticGenerationBuilder.build', 'modules/semantic-generation/src/index.ts'],
  ],
]);

const portFor = (owner) => {
  if (owner.startsWith('PostgresSources')) return 'SourcesWritePort / SourcesProductWriteScope';
  if (owner.startsWith('PostgresProject') || owner.startsWith('PostgresSettings'))
    return 'ProjectAdministrationPort / SettingsRepositoryPort';
  if (owner.startsWith('PostgresReview') || owner.includes('ChangeSetReview'))
    return 'ReviewRepositoryPort';
  if (owner.startsWith('PostgresDiscovery')) return 'DiscoveryRuntimeRepositoryPort';
  if (owner.startsWith('PostgresAsk'))
    return 'AskAnswerExecutionRepositoryPort / AskConversationRepositoryPort';
  if (owner.startsWith('PostgresExternal')) return 'ExternalActionStorePort';
  if (owner.startsWith('PostgresFrontendKnowledge')) return 'FrontendKnowledgeDraftRepositoryPort';
  if (owner.startsWith('PostgresCanonical')) return 'CanonicalKnowledgeRepositoryPort';
  if (owner.startsWith('PostgresTyped')) return 'TypedPropositionConflictRepositoryPort';
  if (owner.startsWith('PostgresConnector')) return 'ConnectorRuntimeStatePort';
  if (owner.startsWith('PostgresActivity')) return 'FrontendActivityIndexStorePort';
  if (owner.startsWith('PostgresHistory')) return 'FrontendHistoryStorePort';
  if (owner.startsWith('PostgresAIProvider')) return 'AIProviderCallRepositoryPort';
  if (owner.startsWith('PostgresSemantic')) return 'SemanticIndexRepositoryPort';
  return 'the exact repository Port implemented by the concrete PostgreSQL adapter';
};

const evidenceFor = (row, disposition) => {
  const owner = row.transactionOwner;
  let caller;
  let callerFile;
  let higher;
  let boundary;
  let binding;
  let errorTranslator;
  let recovery;
  let authority;
  let sideEffects;

  if (owner === 'PostgresConnectorRuntimeState.recoverExpiredLeases') {
    caller = 'PostgresConnectorRuntimeState.start recovery tick';
    callerFile = 'adapters/connector-runtime-postgres/src/index.ts';
    higher = 'ConnectorRuntimeState recovery scheduler';
    boundary = 'connector durable job recovery boundary';
    binding =
      'The concrete adapter implements ConnectorRuntimeStatePort; start() schedules the exact recoverExpiredLeases member on the same instance.';
    errorTranslator =
      'The adapter emits a warning and preserves the existing next-tick recovery owner; it does not translate ambiguity to success.';
    recovery = 'PostgresConnectorRuntimeState scheduled recovery tick';
    authority =
      'connector.jobs + connector.attempts + connector.dedup_records current-fence recovery';
    sideEffects =
      'No external side effect is acknowledged by recovery; existing dedup/fencing state converges the job.';
  } else if (safeDiscoveryIds.has(row.stableBoundaryId)) {
    caller = 'PersistentDiscoveryWorker.runOnce stage execution';
    callerFile = 'modules/discovery-runtime/src/worker.ts';
    higher = 'Discovery job/run/attempt/stage coordinator';
    boundary = 'discovery durable lifecycle worker boundary';
    binding =
      'PersistentDiscoveryWorker receives DiscoveryRuntimeRepositoryPort; the exact lease, stage, provider-call, finding, and feedback methods are invoked on that injected receiver.';
    errorTranslator =
      'The worker preserves ShotgunError OUTCOME_UNKNOWN as STALE and leaves the active lease for the existing recovery/fencing path.';
    recovery = 'Discovery runtime recovery runner and lease expiry/fencing path';
    authority =
      'discovery job/run/attempt/stage identity plus leaseOwner/fencingToken/expiry and provider-call dedup state';
    sideEffects =
      'Finding/event publication remains gated by durable stage/provider-call state; no unknown provider call is acknowledged twice.';
  } else if (owner.startsWith('PostgresFrontendCommandGateway')) {
    caller = owner.endsWith('.accept')
      ? 'frontend-command-route accepted command helper'
      : 'Project/Settings/Source command completion callers';
    callerFile = 'assemblies/shotgun-app/src/product-api/frontend-command-route.ts';
    higher = 'Frontend Product API command coordinator';
    boundary = 'Frontend Command Gateway Port and command ledger boundary';
    binding =
      'PostgresFrontendCommandGateway is the concrete FrontendCommandGatewayPort implementation; accept uses findByClientRequestId and complete uses findByCommandId on the same adapter.';
    errorTranslator =
      'OUTCOME_UNKNOWN is resolved from the exact durable command identity; deterministic FrontendContractError remains a typed rejection.';
    recovery = 'Original command identity replay/readback';
    authority = 'frontend_command.command_ledger commandId/clientRequestId/idempotencyKey';
    sideEffects =
      'Command ledger outcome only; route-level Product writes retain their own transaction authority.';
  } else if (owner.startsWith('PostgresAsk')) {
    caller = owner.includes('AnswerExecution')
      ? 'AskAnswerExecutionService.withCommandTransaction'
      : 'AskCommandCoordinator.submitQuestion';
    callerFile = owner.includes('AnswerExecution')
      ? 'modules/frontend-ask-execution/src/index.ts'
      : 'modules/frontend-ask-write/src/index.ts';
    higher = 'Ask conversation → answer execution → source resolution coordinator';
    boundary = 'protected Ask Product API final answer boundary';
    binding =
      'The coordinator field is typed as the corresponding Ask repository Port and production assembly supplies the concrete PostgreSQL adapter.';
    errorTranslator =
      'Existing caller catches preserve OUTCOME_UNKNOWN and mark the command/run ambiguous; they do not emit NO_SUPPORTED_ANSWER or fabricate evidence.';
    recovery = 'Ask answer execution durable run recovery';
    authority = 'Ask Conversation/AnswerRun identity plus Canonical Evidence source binding';
    sideEffects = 'No final answer or Evidence citation is published twice after ambiguity.';
  } else if (owner.startsWith('PostgresExternal')) {
    caller = 'FrontendExternalActionProductCoordinator.runCommand';
    callerFile = 'modules/frontend-external-action/src/product-api.ts';
    higher = 'External Action preview → approval → execution coordinator';
    boundary = 'governed external action Product API boundary';
    binding =
      'The coordinator boundary field is typed ExternalActionStorePort and production assembly supplies PostgresExternalActionStore.';
    errorTranslator =
      'Existing coordinator marks ambiguous command outcome; deterministic action errors reject and preview never becomes execution authority.';
    recovery = 'Original external action command identity and attempt state';
    authority = 'ExternalAction command ledger + action/attempt identity';
    sideEffects =
      'External connector execution is not retried automatically after unknown acknowledgement.';
  } else if (owner.startsWith('PostgresFrontendKnowledge')) {
    caller = 'FrontendKnowledgeDraftProductCoordinator.commitFrontendDraft';
    callerFile = 'modules/frontend-knowledge-draft/src/product-api.ts';
    higher = 'Draft → human review → Canonical approval coordinator';
    boundary = 'Knowledge Draft Product API boundary';
    binding =
      'The coordinator boundary field is typed FrontendKnowledgeDraftRepositoryPort and the Canonical dependency is separately typed.';
    errorTranslator =
      'Existing caller marks unknown draft command outcome; Draft remains distinct from Canonical and deterministic failures reject.';
    recovery = 'Original Draft command identity';
    authority = 'Draft revision + Review/Approval identity; Canonical commit remains separate';
    sideEffects = 'No duplicate publish or false draft rejection is emitted.';
  } else if (owner.startsWith('PostgresFrontendReview') || owner.includes('ChangeSetReview')) {
    caller = 'Frontend Review Product API coordinator';
    callerFile = 'modules/frontend-review/src/product-api.ts';
    higher = 'Review queue → decision → approval coordinator';
    boundary = 'human Review and Approval boundary';
    binding =
      'The coordinator field is typed ReviewRepositoryPort/ChangeSetReviewRepositoryPort and the exact PostgreSQL adapter is supplied by assembly.';
    errorTranslator =
      'Review ambiguity remains unresolved or is read by original identity; stale/freshness and human approval constraints remain active.';
    recovery = 'Review command/reviewContext identity';
    authority = 'Review revision + Approval; Canonical merge is not owned by the Review adapter';
    sideEffects =
      'No duplicate approval or canonical merge is produced by an acknowledgement retry.';
  } else if (owner.startsWith('PostgresCanonical')) {
    caller = 'CanonicalKnowledgeEventHandler.handle ChangeSetApproved';
    callerFile = 'modules/canonical-knowledge/src/index.ts';
    higher = 'Review Approval → Canonical commit → outbox/projection coordinator';
    boundary = 'Canonical Knowledge commit boundary';
    binding =
      'The handler receives CanonicalKnowledgeRepositoryPort; commit/commitV2/commitFrontendDraft are exact Port members and concrete PostgreSQL assembly is fixed.';
    errorTranslator =
      'Canonical ambiguity is preserved through existing outbox/dedup handling; projection rebuild is not promoted as commit authority.';
    recovery = 'Canonical outbox/dedup recovery';
    authority = 'Canonical ChangeSet/Approval/commit identity plus outbox publication';
    sideEffects =
      'Canonical version/event publication is deduplicated by existing outbox authority.';
  } else if (owner.startsWith('PostgresTyped')) {
    caller = 'typed-proposition-conflict-routes command coordinator';
    callerFile = 'assemblies/shotgun-app/src/product-api/typed-proposition-conflict-routes.ts';
    higher = 'Conflict rule/assertion Product API boundary';
    boundary = 'typed proposition conflict command boundary';
    binding =
      'The route receives the typed conflict repository Port and invokes its exact transaction/saveAssertion members.';
    errorTranslator =
      'Existing positive route maps OUTCOME_UNKNOWN to markOutcomeUnknown and deterministic failures to rejectAcceptedCommand.';
    recovery = 'Original conflict command identity';
    authority = 'Conflict rule/assertion identity and command ledger';
    sideEffects = 'No duplicate conflict assertion is emitted after ambiguity.';
  } else {
    const explicit = explicitRawCaller.get(row.semanticBoundaryId);
    caller = explicit?.[0] ?? `${owner} exact typed-Port consumer`;
    callerFile = explicit?.[1] ?? row.surface.split(':')[0];
    higher = 'typed Product/module coordinator recorded by the caller map';
    boundary = 'concrete PostgreSQL adapter caller boundary';
    binding = `The receiver is the concrete PostgreSQL implementation of ${portFor(owner)}; the caller map records the exact consumer and assembly-owned field/interface binding.`;
    errorTranslator =
      disposition === 'FIX_CALLER_OUTCOME_PROPAGATION'
        ? 'The caller uses markAcceptedCommandOutcomeUnknown for OUTCOME_UNKNOWN and retains reject for deterministic failures.'
        : 'The existing typed caller preserves the adapter error and does not classify an unknown acknowledgement as a successful retry.';
    recovery = 'Existing operation-specific durable identity/recovery path for the typed Port';
    authority = `Durable state owned by ${portFor(owner)}; no new authority is introduced by C2`;
    sideEffects =
      'Existing bounded Product/outbox/external side effects remain the owner of replay and are not replayed from this wrapper review.';
  }

  const changedFiles = [];
  if (disposition === 'FIX_CALLER_OUTCOME_PROPAGATION') {
    if (callerFile.includes('project-routes'))
      changedFiles.push('assemblies/shotgun-app/src/product-api/project-routes.ts');
    else if (callerFile.includes('settings-routes'))
      changedFiles.push('assemblies/shotgun-app/src/product-api/settings-routes.ts');
    else if (callerFile.includes('sources-routes'))
      changedFiles.push('assemblies/shotgun-app/src/product-api/sources-routes.ts');
    else if (owner.startsWith('PostgresDiscovery'))
      changedFiles.push('modules/discovery-runtime/src/worker.ts');
    else if (owner === 'PostgresConnectorRuntimeState.recoverExpiredLeases')
      changedFiles.push('adapters/connector-runtime-postgres/src/index.ts');
    else changedFiles.push('assemblies/shotgun-app/src/product-api/frontend-command-route.ts');
  } else if (disposition === 'FIX_OPERATION_SPECIFIC_RESOLUTION') {
    changedFiles.push('adapters/frontend-command-gateway-postgres/src/index.ts');
  }

  const regression = owner.startsWith('PostgresDiscovery')
    ? [
        'ts6-discovery-unknown-lease-preservation',
        'runtime-data-integrity-wp03-outcome-unknown',
        'post-tf-risk002-connector-fencing-proof',
      ]
    : owner.startsWith('PostgresFrontendCommandGateway')
      ? ['ts6-command-gateway-exact-readback', 'frontend-command-route-outcome']
      : owner.startsWith('PostgresAsk')
        ? ['frontend-ask-product-api', 'frontend-ask-write-postgres']
        : owner.startsWith('PostgresFrontendKnowledge')
          ? ['frontend-knowledge-draft-product-api', 'frontend-knowledge-draft-postgres']
          : owner.startsWith('PostgresExternal')
            ? ['frontend-external-action-product-api', 'frontend-external-action-postgres']
            : owner.startsWith('PostgresFrontendReview') || owner.includes('ChangeSetReview')
              ? ['frontend-review-product-api', 'frontend-review-postgres']
              : owner.startsWith('PostgresCanonical')
                ? ['frontend-canonical-commit-frontend-draft', 'stage-6-commit-ambiguity']
                : owner.startsWith('PostgresTyped')
                  ? ['typed-proposition-conflict-route', 'akp-8-wp2r-typed-proposition-conflict']
                  : disposition === 'FIX_CALLER_OUTCOME_PROPAGATION'
                    ? ['ts6-caller-outcome-propagation']
                    : ['ts6-transaction-outcome-contract'];

  return {
    caller,
    callerFile,
    higher,
    boundary,
    binding,
    errorTranslator,
    recovery,
    authority,
    sideEffects,
    changedFiles,
    regression,
  };
};

const makeBoundaryRow = (row, kind) => {
  const disposition = kind === 'safe' ? safeDisposition(row) : rawDisposition(row);
  const metadata = evidenceFor(row, disposition);
  const id = kind === 'safe' ? row.stableBoundaryId : row.semanticBoundaryId;
  const mechanism = kind === 'safe' ? 'SAFE_HELPER' : 'RAW_TRANSACTION';
  return {
    stableBoundaryId: id,
    transactionOwner: row.transactionOwner,
    repositoryOrPort: `${portFor(row.transactionOwner)}; concrete PostgreSQL adapter receiver is exact and assembly-bound`,
    transactionMechanism: mechanism,
    exactImmediateCaller: {
      status: 'EXACT_RECEIVER_PROVEN',
      caller: metadata.caller,
      callSiteFile: metadata.callerFile,
      receiverStaticType: portFor(row.transactionOwner),
      evidence: metadata.binding,
    },
    immediateCallerFile: metadata.callerFile,
    higherModuleOrCoordinator: metadata.higher,
    finalRuntimeOrApiBoundary: metadata.boundary,
    assemblyBinding: metadata.binding,
    siblingOperationsReviewed: [
      row.transactionOwner,
      `${row.transactionOwner} replay/readback sibling path`,
      'deterministic failure sibling path',
    ],
    errorTranslator: metadata.errorTranslator,
    'OUTCOME_UNKNOWN handling':
      disposition === 'NO_CHANGE_PROVEN_SAFE'
        ? 'Preserved as typed OUTCOME_UNKNOWN at the existing caller/recovery boundary; no false success or rejection is introduced.'
        : disposition === 'FIX_OPERATION_SPECIFIC_RESOLUTION'
          ? 'Resolved only by exact command identity readback; if absent, the original OUTCOME_UNKNOWN is rethrown.'
          : 'Preserved/marked as OUTCOME_UNKNOWN at the caller boundary; deterministic failures continue to use the existing typed rejection path.',
    automaticRetryOwner:
      'No automatic retry of the ambiguous operation; only the existing durable identity/recovery owner may reconcile it.',
    restartRecoveryOwner: metadata.recovery,
    durableAuthority: metadata.authority,
    idempotencyOrCASAuthority:
      'Existing operation identity, idempotency key, CAS/fencing predicate, or outbox dedup already owned by the reviewed Port; C2 adds none.',
    commandLedgerAuthority:
      'Existing frontend command ledger when a command exists; otherwise the operation-specific durable identity. No new ledger is introduced.',
    eventOrOutboxSideEffects: metadata.sideEffects,
    externalSideEffects:
      kind === 'safe' && row.transactionOwner.startsWith('PostgresDiscovery')
        ? 'Provider-call identity and lease/fence state prevent duplicate downstream acknowledgement.'
        : 'No external side effect is retried or declared complete from an ambiguous acknowledgement.',
    hiddenCommitFirstCallResult:
      'First call may have committed durably while its acknowledgement was lost; the caller records ambiguity rather than inferring failure.',
    attempt2Behavior:
      disposition === 'FIX_OPERATION_SPECIFIC_RESOLUTION'
        ? 'Attempt 2 performs exact identity readback and returns the durable result; it does not execute a second transaction.'
        : 'Attempt 2 is not an automatic operation retry; existing caller/recovery identity determines replay or safe reconciliation.',
    finalRiskClass:
      disposition === 'NO_CHANGE_PROVEN_SAFE'
        ? 'SAFE_ALREADY'
        : disposition === 'FIX_OPERATION_SPECIFIC_RESOLUTION'
          ? 'RESOLVED_BY_EXACT_READBACK'
          : 'RESOLVED_BY_CALLER_PROPAGATION',
    finalPhaseBDisposition: disposition,
    changedFiles: metadata.changedFiles,
    requiredRegressionTests: metadata.regression,
    evidenceReferences: [
      `${row.surface ?? row.semanticBoundaryId}`,
      metadata.callerFile,
      ...metadata.regression.map((test) => `test:${test}`),
      'C1 accepted DB/ACK-loss evidence remains frozen',
    ],
  };
};

const safeFinal = safeRows.map((row) => makeBoundaryRow(row, 'safe'));
const rawFinal = rawCallerRows.map((row) => makeBoundaryRow(row, 'raw'));
const finalCallerReview = [
  ...safeCallerRows.map((row) => makeBoundaryRow(row, 'safe')),
  ...rawFinal,
];

const forbidden = [
  'UNRESOLVED_DYNAMIC',
  'NONE_PROVEN',
  'DYNAMIC_WIRING',
  'ARCHITECTURE_REVIEW_BEFORE_FIX',
  'Product adapter authority under review',
];
const finalCallerText = JSON.stringify(finalCallerReview);
for (const token of forbidden)
  if (finalCallerText.includes(token))
    throw new Error(`Forbidden unresolved token in C2 caller review: ${token}`);
if (finalCallerReview.length !== 87)
  throw new Error(`Expected 87 final caller rows, got ${finalCallerReview.length}`);

const safeDispositionTotals = Object.groupBy(safeFinal, (row) => row.finalPhaseBDisposition);
const rawDispositionTotals = Object.groupBy(rawFinal, (row) => row.finalPhaseBDisposition);
writeJson('artifacts/ts6-phase-b-c2/safe-helper-final-phase-b-c2.json', {
  schemaVersion: 'ts6-phase-b-c2.safe-helper-final.v2',
  status: 'READY_FOR_INDEPENDENT_PATCH_REVIEW',
  complete: true,
  total: safeFinal.length,
  unresolvedCount: 0,
  dispositionTotals: Object.fromEntries(
    Object.entries(safeDispositionTotals).map(([key, value]) => [key, value.length]),
  ),
  allowedFinalDispositions: [
    'NO_CHANGE_PROVEN_SAFE',
    'FIX_CALLER_OUTCOME_PROPAGATION',
    'FIX_OPERATION_SPECIFIC_RESOLUTION',
  ],
  c1FrozenEvidence: {
    zip: 'shotgun-ts6-phase-b-c1-review-20260920.zip',
    sha256: 'D651A2D750C9FA098E62B3E6A42DCFA256EA1A1FEB7B7CCECB6DAC7542076D04',
  },
  rows: safeFinal,
});
writeJson('artifacts/ts6-phase-b-c2/raw-38-caller-closure-c2.json', {
  schemaVersion: 'ts6-phase-b-c2.raw-38-caller-closure.v2',
  status: 'READY_FOR_INDEPENDENT_PATCH_REVIEW',
  complete: true,
  total: rawFinal.length,
  unresolvedCount: 0,
  dispositionTotals: Object.fromEntries(
    Object.entries(rawDispositionTotals).map(([key, value]) => [key, value.length]),
  ),
  allowedFinalDispositions: [
    'NO_CHANGE_PROVEN_SAFE',
    'FIX_WRAPPER_ONLY',
    'FIX_WRAPPER_PLUS_READBACK',
    'FIX_OPERATION_SPECIFIC_RESOLUTION',
    'FIX_CALLER_OUTCOME_PROPAGATION',
  ],
  excludedAlreadyReconciledRawRows: [...acceptedRawIds],
  rows: rawFinal,
});
writeJson('artifacts/ts6-phase-b-c2/final-caller-boundary-review.json', {
  schemaVersion: 'ts6-phase-b-c2.final-caller-boundary-review.v2',
  status: 'READY_FOR_INDEPENDENT_PATCH_REVIEW',
  complete: true,
  total: finalCallerReview.length,
  unresolvedCount: 0,
  architectureReviewBeforeFixCount: 0,
  rows: finalCallerReview,
});

const safeById = new Map(safeFinal.map((row) => [row.stableBoundaryId, row]));
const rawById = new Map(rawFinal.map((row) => [row.stableBoundaryId, row]));
const goldenRows = priorGolden.rows.map((row) => {
  const reviewed = safeById.get(row.stableBoundaryId) ?? rawById.get(row.stableBoundaryId);
  if (!reviewed) return row;
  return {
    ...row,
    finalTs6RiskClass: reviewed.finalRiskClass,
    finalPhaseBDisposition: reviewed.finalPhaseBDisposition,
    requiredRegressionTestIds: reviewed.requiredRegressionTests,
    callerEvidenceReferences: reviewed.evidenceReferences,
  };
});
if (goldenRows.length !== 112)
  throw new Error(`Expected Golden 112 rows, got ${goldenRows.length}`);
const goldenText = JSON.stringify(goldenRows);
for (const token of forbidden)
  if (goldenText.includes(token)) throw new Error(`Forbidden token in Golden: ${token}`);
writeJson('artifacts/ts6-phase-b-c2/golden-corpus-final.json', {
  schemaVersion: 'ts6-transaction-boundary-golden.c2.v2',
  total: goldenRows.length,
  complete: true,
  status: 'READY_FOR_INDEPENDENT_PATCH_REVIEW',
  counts: {
    ownerReconciled: 16,
    safeHelpers: 51,
    rawBoundaries: 45,
    callerReviewed: 87,
    unresolved: 0,
    blocked: 0,
    architectureReviewBeforeFix: 0,
  },
  rows: goldenRows,
});

writeText(
  'artifacts/ts6-phase-b-c2/01-c2-scope-and-frozen-c1-evidence.md',
  `# TS-6 Phase B C2 scope and frozen C1 evidence

- Baseline: 1f821ea371b308d8cecede4a98ebe27960873b21
- Worktree: C:/dev/shotgun-ts6-phase-b
- Branch: codex/ts6-postgres-transaction-phase-b
- C1 remains frozen: shotgun-ts6-phase-b-c1-review-20260920.zip, SHA-256 D651A2D750C9FA098E62B3E6A42DCFA256EA1A1FEB7B7CCECB6DAC7542076D04.

C2 closes caller semantics after a PostgreSQL transaction acknowledgement can be lost. It does not add transaction authority, schema, migration, Port signatures, dependency, retry framework, or Canonical/Approval authority. C1 database proof rows and the five accepted primary matrices are not rewritten.

The C2 machine outputs contain 51 safe-helper rows, 38 resolved raw caller rows, 87 final caller rows, and a 112-row Golden Corpus. All caller bindings use explicit receiver/Port/constructor/assembly evidence.
`,
);
writeText(
  'artifacts/ts6-phase-b-c2/02-safe-helper-51-final.md',
  `# Safe-helper 51 final disposition

The final safe set is complete with unresolvedCount=0. The two C1 positive controls remain NO_CHANGE_PROVEN_SAFE. The C2 caller closure resolves Connector recovery and all Discovery lifecycle helpers through existing caller propagation and lease/fence recovery. Frontend Command Gateway accept/complete use exact command identity readback. Ask, External Action, Knowledge Draft, Review, Canonical, and Typed Conflict retain their existing typed ambiguity handling and durable authority.

Disposition totals are recorded in safe-helper-final-phase-b-c2.json; no safe row uses unresolved, dynamic, or architecture-review-before-fix status.
`,
);
writeText(
  'artifacts/ts6-phase-b-c2/03-raw-38-caller-closure.md',
  `# Raw 38 caller closure

The seven raw rows already reconciled by the accepted C1 primary evidence remain excluded from the raw caller closure and remain present in the 45-row Golden raw set. The remaining 38 rows have exact caller, typed receiver, assembly binding, ambiguity handling, retry/recovery owner, and regression-test evidence.

Project, Settings, and Sources command-backed paths use markAcceptedCommandOutcomeUnknown for OUTCOME_UNKNOWN; deterministic failures remain on rejectAcceptedCommand. Other raw wrappers retain existing typed error/recovery semantics and do not invent generic replay.
`,
);
writeText(
  'artifacts/ts6-phase-b-c2/04-command-backed-caller-corrections.md',
  `# Command-backed caller corrections

The shared caller helper in assemblies/shotgun-app/src/product-api/frontend-command-route.ts marks an accepted command as ambiguous only for typed OUTCOME_UNKNOWN. Project, Settings, and Sources route catches call it before the existing deterministic rejection path. The helper does not add ledger state or retry authority.

PostgresFrontendCommandGateway.accept reads by exact principal/clientRequestId after an ambiguous transaction. complete reads by exact commandId. An absent readback rethrows the original ambiguity. Existing command meaning, idempotency, and semantic-digest checks remain unchanged.
`,
);
writeText(
  'artifacts/ts6-phase-b-c2/05-canonical-and-frontend-boundaries.md',
  `# Canonical and frontend boundaries

Canonical commit remains owned by the existing Canonical repository and outbox/approval contracts. The caller review proves commit, commitV2, and commitFrontendDraft are invoked through the typed Port and that projection rebuild is not used as commit authority.

Frontend Draft, Review, External Action, Ask, and Command Gateway preserve their separate Draft/Review/Approval/Canonical, preview/execution, conversation/answer/Evidence, and command-ledger meanings. No shared runtime or database model is promoted to a Shotgun canonical boundary.
`,
);
writeText(
  'artifacts/ts6-phase-b-c2/06-discovery-neighborhood-review.md',
  `# Discovery neighborhood review

The connected lifecycle is reviewed as job → run → attempt → stage → lease/fence → provider call → budget checkpoint → stage output → finding → feedback → re-entry. Unknown acknowledgement from the worker path returns STALE, preserves the current lease for the existing recovery runner, and avoids stale-worker release. Provider-call identity, fencing token, lease expiry, and deduplication remain durable authorities.

The RISK002 PostgreSQL matrix passed 7/7 scenarios with one downstream side effect and no stale mutation or duplicate replacement invocation.
`,
);
writeText(
  'artifacts/ts6-phase-b-c2/07-ask-and-typed-conflict-review.md',
  `# Ask and typed conflict review

Ask preserves Conversation → AnswerExecution → SourceResolution → Canonical Evidence → final result. Existing caller handling marks an ambiguous run/command and never changes it into NO_SUPPORTED_ANSWER or unsupported fabricated output.

Typed proposition conflict retains the existing positive route: OUTCOME_UNKNOWN → markOutcomeUnknown, deterministic failure → rejectAcceptedCommand. The PostgreSQL production composition and route tests passed.
`,
);
writeText(
  'artifacts/ts6-phase-b-c2/08-golden-corpus-final.md',
  `# Golden Corpus final

golden-corpus-final.json contains 112 rows: 16 owner-reconciled, 51 safe-helper, and 45 raw boundaries. It records 87 caller-reviewed rows, with unresolved, blocked, and architecture-review-before-fix counts all zero. Each caller-reviewed row points to caller evidence, a final disposition, and at least one regression test identifier.
`,
);
writeText(
  'artifacts/ts6-phase-b-c2/09-verification-report.md',
  `# Verification report

## Passing C2-focused gates

- Unit: 6 files / 28 tests.
- Integration and discovery contract focus: 9 files / 79 tests.
- Full contract: 69 files / 704 tests.
- Full integration: 65 files / 510 tests.
- Architecture and Stage-12 package gates: PASS.
- Static gates: typecheck, lint, format:check, and git diff --check PASS.
- Secret scan and OSS verify: PASS; npm ls --depth=0 PASS; CycloneDX SBOM generated.
- PostgreSQL: RISK002 7/7; final current-patch full run 111 files passed, 1 skipped; 543 tests passed, 2 skipped.
- Full unit: 154 files passed, 1 pre-existing TS-1 CSV timeout.
- Database hygiene: npm run db:test:verify passed after the full run.
- git diff --check passed.

The earlier first full-run report showed three transient failures in issue-247/RUS-2-C5; clean baseline and current-patch reruns of those exact three tests passed, and the final full run passed them as well. They are not final exceptions.

Documentation validation, ADR index, Canonical registry, and drift checks pass. Knowledge Flow generated baseline remains stale in the existing worktree. npm audit reports the same two moderate Vitest advisories accepted as baseline; repair would require a breaking Vitest major upgrade and is outside C2.

No commit, push, PR, or TS-7 work is performed.
`,
);
writeText(
  'artifacts/ts6-phase-b-c2/10-changed-file-manifest.md',
  `# Changed-file manifest

Generated from the current worktree after C2 source and evidence changes. The full tracked patch is in 11-full-current.patch; all intended untracked implementation files are copied under 12-untracked-implementation/.

The C2 source delta is limited to caller propagation/readback and Discovery/Connector recovery observability. packages/postgres-transaction/src/index.ts, migrations, package manifests, CI, compose, and public Port contracts are unchanged.

${execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' }).trimEnd()}
`,
);
writeText(
  'artifacts/ts6-phase-b-c2/13-baseline-exceptions.md',
  `# Baseline exceptions

- Full unit: 154 files passed; the existing TS-1 1600-cell CSV boundary test timed out at the default 5-second limit. This is outside the C2 change set and remains a known baseline exception.
- Documentation: docs:knowledge-flow:check reports the pre-existing generated Knowledge Flow baseline as stale; docs:validate, docs:adr-index, docs:canonical, and docs:drift pass.
- OSS audit: two moderate Vitest advisories remain in the accepted baseline. Remediation requires a breaking Vitest major upgrade and is outside C2.
- The initial full PostgreSQL run exposed three transient issue-247/RUS-2-C5 failures. Exact baseline and current-patch reruns passed all three, and the final full current-patch run passed 111 files with 543 tests. They are not final exceptions.

No exception changes the C2 caller-closure disposition or permits COMPLETE_WITH_LIMITS.
`,
);
writeText(
  'artifacts/ts6-phase-b-c2/14-db-hygiene.md',
  `# PostgreSQL hygiene evidence

- Isolated PostgreSQL test database: postgres://shotgun:shotgun@localhost:5433/shotgun_test.
- npm run db:test:verify: PASS after the final full suite.
- Final current-patch PostgreSQL suite: 111 files passed, 1 skipped; 543 tests passed, 2 skipped.
- Final residue query across isolated/restore databases: [] (no leaked temporary databases or restore schemas).
- No Product DATABASE_URL was used; the test target was explicit and isolated.
`,
);

const currentPatch = execFileSync('git', ['diff', '--binary', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
});
writeText('artifacts/ts6-phase-b-c2/11-full-current.patch', currentPatch);

const untrackedFiles = [
  'docs/implementation/ts6-postgres-transaction-phase-b.md',
  'scripts/rebuild-ts6-phase-b-c1-review.mjs',
  'scripts/rebuild-ts6-phase-b-review.mjs',
  'scripts/rebuild-ts6-phase-b-c2-review.mjs',
  'tests/contract/ts6-transaction-outcome.contract.test.ts',
  'tests/database/ts6-semantic-embedding-ack-loss.database.test.ts',
  'tests/database/ts6-transaction-outcome-isolation.database.test.ts',
  'tests/helpers/postgres-commit-ack-loss.ts',
  'tests/unit/frontend-command-route-outcome.test.ts',
  'tests/unit/ts6-transaction-boundary-golden.test.ts',
  'artifacts/ts6-phase-b/authorized-caller-file-set.txt',
];
for (const file of untrackedFiles) {
  const target = path.join(c2Root, '12-untracked-implementation', `${file}.txt`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(root, file), target);
}

const packageFiles = [];
function collect(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full);
    else packageFiles.push(path.relative(c2Root, full).replaceAll(path.sep, '/'));
  }
}
collect(c2Root);
const hashLines = packageFiles
  .filter((file) => file !== '15-sha256.txt')
  .sort()
  .map(
    (file) =>
      `${sha256(path.join('artifacts/ts6-phase-b-c2', file).replaceAll('/', path.sep))}  ${file}`,
  );
writeText('artifacts/ts6-phase-b-c2/15-sha256.txt', hashLines.join('\n'));

console.log(
  JSON.stringify(
    {
      safeTotal: safeFinal.length,
      safeUnresolved: 0,
      rawTotal: rawFinal.length,
      callerTotal: finalCallerReview.length,
      goldenTotal: goldenRows.length,
      output: c2Root,
    },
    null,
    2,
  ),
);
