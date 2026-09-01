import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import Fastify from 'fastify';
import staticPlugin from '@fastify/static';

import {
  InMemoryAuthRepository,
  LocalOwnerAuthenticationAdapter,
  authorize,
  hashPassword,
  hashSecuritySecret,
  type AuthRepositoryPort,
  type AuthenticationPort,
  type TrustedPrincipalContext,
  type TrustedSecurityContext,
} from '../../../packages/authentication/src/index.js';

import {
  InMemoryAssetStorage,
  InMemoryIntakeRepository,
  InMemoryOriginalAssetRepository,
} from '../../../adapters/stage2-in-memory/src/index.js';
import {
  InMemoryEvidenceRepository,
  InMemoryTransformationRepository,
} from '../../../adapters/stage3-in-memory/src/index.js';
import { FakeAIProviderAdapter } from '../../../adapters/ai-provider-fake/src/index.js';
import {
  InMemoryAIProviderCallRepository,
  InMemoryCandidateRepository,
  InMemoryValidationRepository,
} from '../../../adapters/stage4-in-memory/src/index.js';
import { LucasAugmentedPlainTextAdapter } from '../../../adapters/plain-text-lucas-augmented/src/index.js';
import { PythonDocumentFormatAdapter } from '../../../adapters/document-format-python/src/index.js';
import {
  InMemoryChangeSetReviewRepository,
  InMemoryComparisonRepository,
} from '../../../adapters/stage5-in-memory/src/index.js';
import { InMemoryCanonicalKnowledgeRepository } from '../../../adapters/stage6-in-memory/src/index.js';
import { InMemorySearchProjectionRepository } from '../../../adapters/stage7-in-memory/src/index.js';
import { InMemoryKnowledgeModelRepository } from '../../../adapters/stage9-in-memory/src/index.js';
import {
  InMemoryTypedPropositionConflictRuleRepository,
  type TypedPropositionConflictAssertionRepositoryPort,
  type TypedPropositionConflictRuleRepositoryPort,
} from '../../../modules/knowledge-model/src/typed-proposition-conflict.js';
import { InMemoryCompiledTruthRepository } from '../../../adapters/stage10-in-memory/src/index.js';
import { InMemorySemanticIndexRepository } from '../../../adapters/semantic-index-in-memory/src/index.js';
import {
  InMemoryDiscoveryRuntimeRepository,
  InMemoryDiscoveryScheduleRepository,
  PostgresCanonicalCommittedSourceAdapter,
  PostgresDiscoveryProjectionReadinessAdapter,
} from '../../../adapters/discovery-trigger-coordinator/src/index.js';
import {
  InMemoryActionCandidateRepository,
  InMemoryActionExecutionRepository,
} from '../../../adapters/stage11-in-memory/src/index.js';
import {
  InMemoryProjectAdministrationRepository,
  InMemoryProjectBootstrapUnitOfWork,
  InMemoryProjectTombstoneStore,
  InMemorySettingsRepository,
} from '../../../adapters/settings-project-admin-in-memory/src/index.js';
import { InMemoryFrontendCommandGateway } from '../../../adapters/frontend-command-gateway-in-memory/src/index.js';
import { InMemoryDiscoveryFeedbackRepository } from '../../../adapters/discovery-feedback-in-memory/src/index.js';
import {
  InMemoryActionCenterProjection,
  InMemoryAskWorkspaceProjection,
  InMemoryBackgroundSummaryProjection,
  InMemoryGlobalShellProjection,
  InMemoryNotificationSummaryProjection,
  InMemoryRouteGuardProjection,
} from '../../../adapters/frontend-product-read-in-memory/src/index.js';
import { PostgresSourceLibraryGlobalSearch } from '../../../adapters/frontend-product-read-postgres/src/index.js';
import {
  FrontendProductReadCoordinator,
  type ActionCenterProjectionPort,
} from '../../../modules/frontend-product-read/src/index.js';
import {
  FrontendDiscoveryProductReadCoordinator,
  createEmptyDiscoveryProductReadSource,
} from '../../../modules/frontend-discovery-product/src/index.js';
import type { DiscoveryFindingLifecycleService } from '../../../modules/discovery-finding-lifecycle/src/index.js';
import {
  DiscoveryFeedbackProductCoordinator,
  type DiscoveryFeedbackRepositoryPort,
} from '../../../modules/discovery-feedback/src/index.js';
import { AskCommandCoordinator } from '../../../modules/frontend-ask-write/src/index.js';
import type { AskAnswerExecutionService } from '../../../modules/frontend-ask-execution/src/index.js';
import {
  FrontendSourcesReadCoordinator,
  type SourcesProjectionRepositoryPort,
} from '../../../modules/frontend-sources-product/src/index.js';
import { InMemoryAskConversationRepository } from '../../../adapters/frontend-ask-write-in-memory/src/index.js';
import type {
  ProjectAdministrationRepositoryPort,
  ProjectBootstrapUnitOfWorkPort,
  ProjectTombstoneStorePort,
} from '../../../modules/project-administration/src/index.js';
import type {
  PayloadStateOwner,
  PayloadStateStorePort,
} from '../../../modules/frontend-history/src/index.js';
import type {
  PolicyHistoryReadPort,
  SettingsRepositoryPort,
} from '../../../modules/settings-policy/src/index.js';
import type { FrontendCommandGatewayPort } from '../../../modules/frontend-command-gateway/src/index.js';
import type { AISettingsBackendPort } from '../../../modules/ai-settings-backend/src/index.js';
import type { ProviderExternalTransferApprovalPort } from '../../../modules/provider-privacy-policy/src/index.js';
import { registerProjectRoutes } from './product-api/project-routes.js';
import { registerFrontendProductRoutes } from './product-api/frontend-product-routes.js';
import { registerSettingsRoutes } from './product-api/settings-routes.js';
import { registerTypedPropositionConflictRuleRoutes } from './product-api/typed-proposition-conflict-routes.js';
import { registerAISettingsRoutes } from './product-api/ai-settings-routes.js';
import { registerSourcesRoutes } from './product-api/sources-routes.js';
import { registerFrontendKnowledgeDraftRoutes } from './product-api/frontend-knowledge-draft-routes.js';
import { registerFrontendReviewRoutes } from './product-api/frontend-review-routes.js';
import { registerFrontendExternalActionRoutes } from './product-api/frontend-external-action-routes.js';
import { registerActivityRoutes } from './product-api/frontend-activity-routes.js';
import { registerHistoryRoutes } from './product-api/frontend-history-routes.js';
import {
  ActivityProductCoordinator,
  ActivityProjectionBuilder,
  type ActivityReadModelStorePort,
  type AskActivityReadPort,
  type DiscoveryActivityFindingReadPort,
  type DiscoveryActivityReadPort,
  type SourcesActivityReadPort,
} from '../../../modules/frontend-activity/src/index.js';
import {
  HistoryProductCoordinator,
  createHistoryAdapterRegistry,
  type HistoryReadModelStorePort,
} from '../../../modules/frontend-history/src/index.js';
import {
  createInMemoryHistoryReadModelStore,
  InMemoryPayloadStateStore,
} from '../../../adapters/frontend-history-in-memory/src/index.js';
import { InMemoryPolicyHistoryReadAdapter } from '../../../adapters/settings-project-admin-in-memory/src/index.js';
import { CanonicalHistoryAdapter } from '../../../adapters/frontend-history-canonical/src/index.js';
import { ReviewHistoryAdapter } from '../../../adapters/frontend-history-review/src/index.js';
import { ExternalActionHistoryAdapter } from '../../../adapters/frontend-history-external-action/src/index.js';
import { PolicyHistoryAdapter } from '../../../adapters/frontend-history-policy/src/index.js';
import { createInMemoryActivityReadModelStore } from '../../../adapters/frontend-activity-in-memory/src/index.js';
import { SourcesActivityAdapter } from '../../../adapters/frontend-activity-sources/src/index.js';
import { createInMemorySourcesActivityRead } from '../../../adapters/frontend-activity-sources/src/index.js';
import { AskActivityAdapter } from '../../../adapters/frontend-activity-ask/src/index.js';
import { createInMemoryAskActivityRead } from '../../../adapters/frontend-activity-ask/src/index.js';
import { ExternalActionActivityAdapter } from '../../../adapters/frontend-activity-external-action/src/index.js';
import {
  DiscoveryActivityAdapter,
  createInMemoryDiscoveryActivityRead,
} from '../../../adapters/frontend-activity-discovery/src/index.js';
import type { ExternalActionRepositoryBoundaryPort } from '../../../modules/frontend-external-action/src/external-action-store-port.js';
import { CoordinatorActionCenterAttentionProjection } from './action-center-attention-projection.js';
import {
  registerFrontendKnowledgeGraphRoutes,
  type GraphScopeResolver,
} from './product-api/frontend-knowledge-graph-routes.js';
import type { GraphReadDomain } from '../../../modules/frontend-knowledge-graph/src/index.js';
import {
  createGraphDiscoveryOverlayPort,
  createGraphReadDomain,
  type GraphDiscoveryOverlayPort,
} from '../../../modules/frontend-knowledge-graph/src/index.js';
import {
  createInMemoryHealthStore,
  createInMemorySnapshotContextStore,
} from '../../../adapters/frontend-knowledge-graph-in-memory/src/index.js';
import { Stage9GraphReadAdapter } from '../../../adapters/stage9-graph-read/src/index.js';
import {
  FrontendKnowledgeDraftProductCoordinator,
  type FrontendKnowledgeDraftDiscoveryRelationAuthorityPort,
  type FrontendKnowledgeDraftTargetResolverPort,
} from '../../../modules/frontend-knowledge-draft/src/product-api.js';
import type { FrontendKnowledgeDraftRepositoryBoundaryPort } from '../../../modules/frontend-knowledge-draft/src/index.js';
import { InMemoryFrontendKnowledgeDraftRepository } from '../../../adapters/frontend-knowledge-draft-in-memory/src/index.js';
import { InMemoryFrontendKnowledgeDraftTargetResolver } from '../../../adapters/frontend-knowledge-draft-api-in-memory/src/index.js';
import {
  FrontendReviewProductCoordinator,
  type ReviewRepositoryBoundaryPort,
  type FrontendReviewAcceptedForAuthoringBridgeV1,
} from '../../../modules/frontend-review/src/index.js';
import { InMemoryFrontendReviewStore } from '../../../adapters/frontend-review-in-memory/src/index.js';
import { FrontendExternalActionProductCoordinator } from '../../../modules/frontend-external-action/src/index.js';
import {
  FakeExternalActionEngine,
  InMemoryExternalActionStore,
} from '../../../adapters/frontend-external-action-in-memory/src/index.js';
import {
  DraftReviewTargetAdapter,
  DiscoveryCandidateReviewTargetAdapter,
  UserDirectiveReviewTargetAdapter,
  createEmptyReviewDraftSourceReader,
  createInMemoryReviewDraftSourceReader,
  createInMemoryReviewDiscoveryCandidateReader,
  createInMemoryReviewUserDirectiveReader,
  type ReviewDiscoveryCandidateReader,
  type ReviewDraftSourceReader,
} from '../../../adapters/frontend-review-in-memory/src/index.js';
import { FakeDraftActionConnector } from '../../../adapters/action-connector-fake/src/index.js';
import { JsDiffAdapter } from '../../../adapters/text-diff-jsdiff/src/index.js';
import { InProcessTransport } from '../../../adapters/transport-in-process/src/index.js';
import {
  createChildQuery,
  createCommand,
  createQuery,
  actionEvidenceSetDigest,
  actionEvidenceRecordDigest,
  sha256Text,
  validationResultDigest,
  ShotgunError,
  createProductFailureEnvelope,
  getFailureDescriptor,
  ShotgunKernel,
  type AssetReference,
  type MessageTransport,
  type SecurityContext,
  type ApprovedChangeSetManifest,
  type CanonicalCommitResult,
  type CanonicalHistoryEvent,
  type CanonicalSnapshot,
  type CanonicalSearchResponse,
  type CitedAnswer,
  type ClaimCandidate,
  type ComparisonResult,
  type DraftChangeSet,
  type EvidenceSpan,
  type TextDiffSegment,
  type EntityCandidate,
  type EntityVaultImport,
  type KnowledgeCandidate,
  type KnowledgeGraphView,
  type KnowledgeImpactResult,
  type KnowledgeReviewGroup,
  type CompiledTruthProjection,
  type CompiledTruthProjectionStatus,
  type ProjectionReadiness,
  type DerivedInferenceCandidate,
  type ActionAuditEvent,
  type ActionExecutionRecord,
  type HybridSearchRequest,
  type HybridSearchResponse,
} from '../../../packages/kernel/src/index.js';
import {
  type HybridRetrievalCoordinatorPort,
  type KnowledgeResourceResolverPort,
  type SemanticActiveGenerationReaderPort,
  type SemanticProjectionRefreshPort,
  type SemanticRetrieverPort,
} from '../../../packages/contracts/src/index.js';
import {
  createHybridRetrievalModule,
  HybridRetrievalCoordinator,
  LexicalRetriever,
  ProductKnowledgeResourceResolver,
} from '../../../modules/hybrid-retrieval/src/index.js';
import {
  createIntakeModule,
  type IntakeRepositoryPort,
  type SubmitIntakePayload,
} from '../../../modules/intake/src/index.js';
import {
  type AssetStoragePort,
  createOriginalAssetModule,
  type OriginalAssetRepositoryPort,
} from '../../../modules/original-asset/src/index.js';
import {
  createEvidenceModule,
  type EvidenceLocatorPort,
  type EvidenceRepositoryPort,
} from '../../../modules/evidence/src/index.js';
import {
  createAIProviderModule,
  type AIProviderAdapterPort,
  type AIProviderCallRepositoryPort,
  type AIProviderPolicy,
} from '../../../modules/ai-provider/src/index.js';
import {
  createCandidateGenerationModule,
  type CandidateRepositoryPort,
} from '../../../modules/candidate-generation/src/index.js';
import {
  createValidationModule,
  type ValidationRepositoryPort,
} from '../../../modules/validation/src/index.js';
import {
  createComparisonModule,
  type CanonicalSnapshotPort,
  type ComparisonRepositoryPort,
  type TextDiffPort,
} from '../../../modules/comparison/src/index.js';
import {
  createChangeSetReviewModule,
  createReversalEligibilityPort,
  type ChangeSetReviewRepositoryPort,
} from '../../../modules/change-set-review/src/index.js';
import {
  createCanonicalKnowledgeModule,
  type CanonicalKnowledgeRepositoryPort,
} from '../../../modules/canonical-knowledge/src/index.js';
import { createCitedAnswerModule } from '../../../modules/cited-answer/src/index.js';
import {
  createProjectionSearchModule,
  type SearchProjectionRepositoryPort,
} from '../../../modules/projection-search/src/index.js';
import {
  createTransformationModule,
  type PlainTextTransformerPort,
  type TransformationRevisionSecurityRepositoryPort,
  type TransformationRepositoryPort,
} from '../../../modules/transformation/src/index.js';
import { createPingModule } from '../../../modules/ping/src/index.js';
import { createPongModule } from '../../../modules/pong/src/index.js';
import {
  createKnowledgeModelModule,
  type KnowledgeModelRepositoryPort,
} from '../../../modules/knowledge-model/src/index.js';
import {
  createCompiledTruthModule,
  type CompiledTruthRepositoryPort,
} from '../../../modules/compiled-truth/src/index.js';
import { RepositorySemanticCorpusSourceSnapshotReader } from '../../../adapters/semantic-corpus-repository/src/index.js';
import type { SemanticCorpusSourceSnapshotReaderPort } from '../../../packages/contracts/src/index.js';
import type {
  SemanticProjectionGeneration,
  SemanticGenerationPointer,
} from '../../../packages/contracts/src/index.js';
import {
  createDiscoveryTriggerCoordinatorModule,
  DiscoveryTriggerCoordinator,
  PersistentDiscoveryScheduler,
  startPersistentDiscoverySchedulerWorker,
  StaticDiscoveryTriggerPolicy,
  type DiscoveryTriggerRuntimeRepositoryPort,
} from '../../../modules/discovery-trigger-coordinator/src/index.js';
import type {
  DiscoveryScheduleRepositoryPort,
  DiscoveryScheduleStatusV1,
  DiscoveryTriggerPolicyPort,
  DiscoveryManualTriggerRequestV1,
} from '../../../packages/contracts/src/index.js';
import type { PersistentDiscoveryWorker } from '../../../modules/discovery-runtime/src/index.js';
import type {
  DiscoveryReentryFreshnessEvaluatorPort,
  PersistentDiscoveryReentryWorker,
} from '../../../modules/discovery-reentry/src/index.js';
import {
  type ActionConnectorPort,
  type ActionCandidateRepositoryPort,
  type ActionExecutionRepositoryPort,
  createActionExecutionModule,
} from '../../../modules/action-execution/src/index.js';
import { createProductSessionView, type ProductSessionView } from './product-api/session-view.js';

type PingRequest = {
  readonly requestId?: string;
  readonly message?: string;
};

type ResolveAssetRequest = {
  readonly assetReference: AssetReference;
};

type SourceVersionRequest = {
  readonly sourceVersionId: string;
};

type EvidenceRequest = {
  readonly evidenceId: string;
};

type CandidateRequest = {
  readonly candidateId: string;
};

type ComparisonRequest = {
  readonly comparisonId: string;
};

type ChangeSetRequest = {
  readonly changeSetId: string;
};

type CanonicalClaimRequest = {
  readonly claimId: string;
};

type CanonicalCommitRequest = {
  readonly commitId: string;
};

type SearchRequest = { readonly query: string; readonly limit?: number };
type AskRequest = { readonly question: string; readonly limit?: number };

export const isLoopbackIp = (ipAddress: string | undefined): boolean => {
  if (!ipAddress) return false;
  let raw = ipAddress.trim().toLowerCase();

  // Strip IPv4-mapped IPv6 prefix
  if (raw.startsWith('::ffff:')) {
    raw = raw.slice(7);
  }

  // Strip IPv6 brackets if present
  if (raw.startsWith('[')) {
    const endBracket = raw.indexOf(']');
    if (endBracket !== -1) {
      raw = raw.slice(1, endBracket);
    }
  } else if (raw.includes(':') && !raw.includes('::')) {
    // Strip port if IPv4 with port, e.g. 127.0.0.1:5173
    const firstColon = raw.indexOf(':');
    raw = raw.slice(0, firstColon);
  }

  if (raw === '127.0.0.1' || raw === 'localhost' || raw === '::1' || raw === '0:0:0:0:0:0:0:1') {
    return true;
  }

  // 127.0.0.0/8 IPv4 loopback range
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(raw)) {
    const parts = raw.split('.').map(Number);
    return parts.length === 4 && parts.every((p) => p >= 0 && p <= 255);
  }

  return false;
};

export const isSameOriginRequest = (
  originHeader?: string,
  refererHeader?: string,
  hostHeader?: string,
): boolean => {
  const origin = originHeader?.trim();
  const referer = refererHeader?.trim();

  // Explicit policy: Origin: null is an opaque origin (sandboxed iframe / cross-domain file:), reject.
  if (origin === 'null') {
    return false;
  }

  const targetUrlStr = origin || referer;
  // Explicit policy: If both Origin and Referer are missing, allow direct loopback call.
  if (!targetUrlStr) {
    return true;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(targetUrlStr);
  } catch {
    return false;
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return false;
  }

  const originHost = parsedUrl.hostname.toLowerCase();
  const originPort = parsedUrl.port || (parsedUrl.protocol === 'https:' ? '443' : '80');

  const isLoopbackHost =
    originHost === '127.0.0.1' || originHost === '::1' || originHost === 'localhost';

  if (!hostHeader) {
    return isLoopbackHost;
  }

  let expectedHost = hostHeader.trim().toLowerCase();
  let expectedPort = parsedUrl.protocol === 'https:' ? '443' : '80';
  if (expectedHost.includes(':')) {
    const lastColon = expectedHost.lastIndexOf(':');
    const bracketIndex = expectedHost.lastIndexOf(']');
    if (bracketIndex === -1 || lastColon > bracketIndex) {
      expectedPort = expectedHost.slice(lastColon + 1);
      expectedHost = expectedHost.slice(0, lastColon);
    }
  }
  expectedHost = expectedHost.replace(/^\[|\]$/g, '');

  const isExpectedLoopbackHost =
    expectedHost === '127.0.0.1' || expectedHost === '::1' || expectedHost === 'localhost';

  const hostMatches = originHost === expectedHost || (isLoopbackHost && isExpectedLoopbackHost);

  const portMatches = originPort === expectedPort;

  return hostMatches && portMatches;
};

type KnowledgeStageRequest = {
  readonly groupId: string;
  readonly sourceVersionId: string;
  readonly items: readonly KnowledgeCandidate[];
};

type KnowledgeReviewRequest = {
  readonly decisionId?: string;
  readonly groupId: string;
  readonly expectedRevisionNumber: number;
  readonly expectedContentDigest: string;
  readonly decision: 'APPROVE' | 'HOLD' | 'REJECT' | 'EDIT';
  readonly reason: string;
  readonly itemIds: readonly string[];
  readonly editKind?:
    'WORDING_LAYOUT' | 'FACTUAL_CORRECTION' | 'NEW_KNOWLEDGE' | 'REFERENCE_CHANGE';
};

type KnowledgeImpactRequest = {
  readonly rootCandidateId: string;
  readonly maxDepth?: number;
  readonly maxNodes?: number;
};

type EntityVaultStageRequest = {
  readonly importId: string;
  readonly sourceVersionId: string;
  readonly entities: readonly EntityCandidate[];
};

type EntityVaultReviewRequest = {
  readonly importId: string;
  readonly expectedContentDigest: string;
  readonly decision: 'APPROVE' | 'REJECT';
};

type ReviewDecisionRequest = ChangeSetRequest & {
  readonly decisionId?: string;
  readonly expectedRevisionNumber: 1;
  readonly expectedContentDigest: string;
  readonly decision: 'APPROVE' | 'HOLD' | 'REJECT';
  readonly reason: string;
};

export type SecurityHeaders = {
  readonly 'x-project-id'?: string;
  readonly 'x-actor-id'?: string;
  readonly 'x-access-scope'?: string;
  readonly 'x-sensitivity'?: SecurityContext['sensitivity'];
  readonly 'x-shotgun-project'?: string;
  readonly authorization?: string;
  readonly cookie?: string;
  readonly 'x-csrf-token'?: string;
  readonly 'x-idempotency-key'?: string;
};

export type ApplicationOptions = {
  readonly transport?: MessageTransport;
  readonly intakeRepository?: IntakeRepositoryPort;
  readonly originalAssetRepository?: OriginalAssetRepositoryPort;
  readonly assetStorage?: AssetStoragePort;
  readonly transformationRepository?: TransformationRepositoryPort;
  readonly transformationRevisionSecurityRepository?: TransformationRevisionSecurityRepositoryPort;
  readonly evidenceRepository?: EvidenceRepositoryPort;
  readonly transformer?: PlainTextTransformerPort;
  readonly evidenceLocator?: EvidenceLocatorPort;
  readonly aiProviderRepository?: AIProviderCallRepositoryPort;
  readonly candidateRepository?: CandidateRepositoryPort;
  readonly validationRepository?: ValidationRepositoryPort;
  readonly aiProvider?: AIProviderAdapterPort;
  readonly aiProviderPolicy?: AIProviderPolicy;
  readonly canonicalSnapshot?: CanonicalSnapshotPort;
  readonly textDiff?: TextDiffPort;
  readonly comparisonRepository?: ComparisonRepositoryPort;
  readonly changeSetReviewRepository?: ChangeSetReviewRepositoryPort;
  readonly canonicalKnowledgeRepository?: CanonicalKnowledgeRepositoryPort;
  readonly searchProjectionRepository?: SearchProjectionRepositoryPort;
  readonly knowledgeModelRepository?: KnowledgeModelRepositoryPort;
  readonly typedPropositionConflictRuleRepository?: TypedPropositionConflictRuleRepositoryPort;
  readonly typedPropositionConflictAssertionRepository?: TypedPropositionConflictAssertionRepositoryPort;
  readonly compiledTruthRepository?: CompiledTruthRepositoryPort;
  readonly semanticCorpusSourceSnapshotReader?: SemanticCorpusSourceSnapshotReaderPort;
  readonly discoveryRuntimeRepository?: DiscoveryTriggerRuntimeRepositoryPort;
  readonly discoveryScheduleRepository?: DiscoveryScheduleRepositoryPort;
  readonly discoverySchedulerIntervalMs?: number | false;
  /** WP4 durable execution worker; omitted by recovery/test compositions. */
  readonly discoveryExecutionWorker?: Pick<PersistentDiscoveryWorker, 'start' | 'stop'>;
  /** AKP-5 WP2 FindingReady re-entry consumer; omitted by recovery/test compositions. */
  readonly discoveryReentryWorker?: Pick<PersistentDiscoveryReentryWorker, 'start' | 'stop'>;
  /** AKP-5 WP5 server-owned stale/provenance/security evaluator. */
  readonly discoveryReentryFreshnessEvaluator?: DiscoveryReentryFreshnessEvaluatorPort;
  readonly discoverySemanticIndexRepository?: {
    getActiveGenerationPointer(projectId: string): Promise<SemanticGenerationPointer | undefined>;
    getGeneration(
      projectId: string,
      generationId: string,
    ): Promise<SemanticProjectionGeneration | undefined>;
  };
  readonly discoveryTriggerPolicy?: DiscoveryTriggerPolicyPort;
  readonly actionCandidateRepository?: ActionCandidateRepositoryPort;
  readonly actionExecutionRepository?: ActionExecutionRepositoryPort;
  readonly actionConnector?: ActionConnectorPort;
  readonly authRepository?: AuthRepositoryPort;
  readonly authenticationAdapter?: AuthenticationPort;
  readonly projectAdminRepository?: ProjectAdministrationRepositoryPort;
  readonly projectBootstrapUnitOfWork?: ProjectBootstrapUnitOfWorkPort;
  readonly settingsRepository?: SettingsRepositoryPort;
  readonly aiSettingsBackend?: AISettingsBackendPort;
  /** Existing A4 authority exposed only through provider-scoped review routes. */
  readonly providerExternalTransferApprovals?: ProviderExternalTransferApprovalPort;
  readonly frontendCommandGateway?: FrontendCommandGatewayPort;
  /** AKP-7 WP1 feedback/suppression authority reused by the WP2 Product API. */
  readonly discoveryFeedbackRepository?: DiscoveryFeedbackRepositoryPort;
  readonly discoveryFeedbackProductCoordinator?: DiscoveryFeedbackProductCoordinator;
  readonly frontendKnowledgeDraftRepository?: FrontendKnowledgeDraftRepositoryBoundaryPort;
  readonly frontendKnowledgeDraftTargetResolver?: FrontendKnowledgeDraftTargetResolverPort;
  readonly frontendKnowledgeDraftCoordinator?: FrontendKnowledgeDraftProductCoordinator;
  readonly frontendReviewCoordinator?: FrontendReviewProductCoordinator;
  /** Review Authority boundary (contexts/decisions/approvals). Production
   *  composition must be PostgreSQL-backed so governed Review commands share
   *  the Command Ledger transaction and Approval persistence survives
   *  restart (Cross-Phase WP-XP2 discovery). */
  readonly frontendReviewStore?: ReviewRepositoryBoundaryPort;
  /** Production-only atomic Discovery Review → Draft bridge. */
  readonly frontendReviewAuthoringBridge?: FrontendReviewAcceptedForAuthoringBridgeV1;
  /** Cross-Phase: PostgreSQL-backed Review submission source for the Draft →
   *  Review queue when the Knowledge Draft repository is not in-memory. */
  readonly frontendReviewDraftSourceReader?: ReviewDraftSourceReader;
  /** Production Review source for persisted, post-validation Discovery resources. */
  readonly frontendReviewDiscoveryCandidateReader?: ReviewDiscoveryCandidateReader;
  readonly frontendExternalActionCoordinator?: FrontendExternalActionProductCoordinator;
  readonly graphReadDomain?: GraphReadDomain;
  readonly graphDiscoveryOverlayPort?: GraphDiscoveryOverlayPort;
  readonly graphScopeResolver?: GraphScopeResolver;
  readonly frontendProductReadCoordinator?: FrontendProductReadCoordinator;
  /** AKP-6 WP1 server-authoritative Discovery Product read boundary. */
  readonly frontendDiscoveryProductReadCoordinator?: FrontendDiscoveryProductReadCoordinator;
  /** AKP-6 WP5 governed Discovery Finding owner actions. */
  readonly frontendDiscoveryFindingLifecycleService?: DiscoveryFindingLifecycleService;
  readonly frontendProductReadCoordinatorFactory?: (
    connector: ShotgunKernel['connector'],
    actionCenterProjection: ActionCenterProjectionPort,
    sources: FrontendSourcesReadCoordinator,
  ) => FrontendProductReadCoordinator;
  readonly askCommandCoordinator?: AskCommandCoordinator;
  readonly askAnswerExecution?: AskAnswerExecutionService;
  readonly sourcesProjectionRepository?: SourcesProjectionRepositoryPort;
  readonly activitySourcesRead?: SourcesActivityReadPort;
  readonly activityAskRead?: AskActivityReadPort;
  readonly activityDiscoveryRead?: DiscoveryActivityReadPort;
  readonly activityDiscoveryFindingRead?: DiscoveryActivityFindingReadPort;
  readonly activityExternalActionBoundary?: ExternalActionRepositoryBoundaryPort;
  readonly activityReadModelStore?: ActivityReadModelStorePort;
  readonly activityCoordinator?: ActivityProductCoordinator;
  readonly historyReadModelStore?: HistoryReadModelStorePort;
  readonly historyCoordinator?: HistoryProductCoordinator;
  readonly projectTombstoneStore?: ProjectTombstoneStorePort;
  readonly policyHistoryRead?: PolicyHistoryReadPort;
  readonly historyPayloadStates?: Partial<Record<PayloadStateOwner, PayloadStateStorePort>>;
  readonly historyReviewBoundary?: ReviewRepositoryBoundaryPort;
  readonly host?: string;
  readonly production?: boolean;
  /** LPA-WP4 (Local Launch / Serving Usability): absolute path to the built
   *  SPA (`apps/shotgun-web/dist`). When set, the Fastify server serves the
   *  SPA from the SAME origin (LPA-D02/D04) with a browser-route-only SPA
   *  fallback; reserved API namespaces are never absorbed (LPA-D05). */
  readonly spaDirectory?: string;
  readonly canonicalProjectionRecoveryIntervalMs?: number | false;
  readonly canonicalProjectionRecoveryReporter?: CanonicalProjectionRecoveryReporterPort;
  readonly semanticRetriever?: SemanticRetrieverPort;
  readonly semanticActiveGenerationReader?: SemanticActiveGenerationReaderPort;
  readonly semanticProjectionRefresh?: SemanticProjectionRefreshPort;
  readonly hybridRetrievalCoordinator?: HybridRetrievalCoordinatorPort;
  /** LPA-WP5 (D12 recovery harness / R3-1): when `false`, the startup AI
   *  Durable Materialization Recovery is NOT run (no expired-attempt mutation,
   *  no resume commands). Defaults to `true` — the normal Product startup
   *  behavior is unchanged. The recovery harness enables only the Canonical
   *  Projection Recovery. */
  readonly aiDurableMaterializationRecoveryEnabled?: boolean;
  readonly closeResources?: () => Promise<void>;
};

type AIDurableRecoveryConnector = {
  sendCommand(command: ReturnType<typeof createCommand>): Promise<unknown>;
};

export const runAIDurableMaterializationRecovery = async (
  aiProviderRepository: AIProviderCallRepositoryPort,
  connector: AIDurableRecoveryConnector,
): Promise<{ readonly attempted: number; readonly resumed: number; readonly failed: number }> => {
  await aiProviderRepository.markExpiredRunningAttemptsOutcomeUnknown();
  const records = await aiProviderRepository.listRecoverableMaterializations();
  let resumed = 0;
  for (const record of records) {
    try {
      await connector.sendCommand(
        createCommand({
          messageType: 'ResumeCandidateMaterialization',
          schemaVersion: '1.0.0',
          producerModule: 'shotgun-app',
          producerVersion: '1.0.0',
          idempotencyKey: `resume-candidate-materialization:${record.projectId}:${record.requestId}:${record.output?.outputId}`,
          projectId: record.projectId,
          actor: { type: 'service', id: 'stage12-1-durable-materialization-recovery' },
          security: {
            accessScope: record.accessScope,
            sensitivity: record.sensitivity,
            dataClassification: record.dataClassification,
          },
          payload: { sourceVersionId: record.sourceVersionId, requestId: record.requestId },
        }),
      );
      resumed += 1;
    } catch {
      // Recovery is fail-closed per item; no Provider call is made by Resume.
    }
  }
  return { attempted: records.length, resumed, failed: records.length - resumed };
};

export type CanonicalProjectionRecoveryConnector = {
  sendCommand<TResult = unknown>(
    command: ReturnType<typeof createCommand>,
  ): Promise<{ readonly result: TResult }>;
  query<TResult = unknown>(
    query: ReturnType<typeof createQuery>,
  ): Promise<{ readonly result: { readonly payload: TResult } }>;
};

export type CanonicalProjectionRecoveryProjectResult = {
  readonly projectId: string;
  readonly status: 'READY' | 'FAILED';
  readonly outboxPublished: number;
  readonly searchRebuilt: boolean;
  readonly compiledTruthRebuilt: boolean;
  readonly error?: string;
};

export type CanonicalProjectionRecoveryResult = {
  readonly projects: readonly CanonicalProjectionRecoveryProjectResult[];
  readonly ready: number;
  readonly failed: number;
};

export type CanonicalProjectionRecoveryTrigger = 'STARTUP' | 'PERIODIC' | 'MANUAL';

export type CanonicalProjectionRecoverySafeProjectResult = Omit<
  CanonicalProjectionRecoveryProjectResult,
  'error'
> & {
  readonly failureCode?: 'RECOVERY_FAILED';
};

export type CanonicalProjectionRecoverySafeResult = {
  readonly projects: readonly CanonicalProjectionRecoverySafeProjectResult[];
  readonly ready: number;
  readonly failed: number;
};

export type CanonicalProjectionRecoveryReport = {
  readonly trigger: CanonicalProjectionRecoveryTrigger;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly result?: CanonicalProjectionRecoverySafeResult;
  readonly runStatus: 'COMPLETED' | 'FAILED';
  readonly safeError?: 'CANONICAL_PROJECTION_RECOVERY_FAILED';
};

export type CanonicalProjectionRecoveryReporterPort = {
  report(value: CanonicalProjectionRecoveryReport): Promise<void>;
};

export class InMemoryCanonicalProjectionRecoveryReporter implements CanonicalProjectionRecoveryReporterPort {
  private readonly values: CanonicalProjectionRecoveryReport[] = [];

  async report(value: CanonicalProjectionRecoveryReport): Promise<void> {
    this.values.push(value);
  }

  latest(): CanonicalProjectionRecoveryReport | undefined {
    return this.values.at(-1);
  }

  reports(): readonly CanonicalProjectionRecoveryReport[] {
    return [...this.values];
  }
}

const safeRecoveryResult = (
  result: CanonicalProjectionRecoveryResult,
): CanonicalProjectionRecoverySafeResult => ({
  projects: result.projects.map(({ error: _error, ...project }) =>
    _error === undefined ? project : { ...project, failureCode: 'RECOVERY_FAILED' as const },
  ),
  ready: result.ready,
  failed: result.failed,
});

const recordRecoveryReport = async (
  reporter: CanonicalProjectionRecoveryReporterPort,
  report: CanonicalProjectionRecoveryReport,
): Promise<void> => {
  try {
    await reporter.report(report);
  } catch {
    // Recovery remains retryable if an optional observability adapter is unavailable.
  }
};

const recoveryEnvelopeContext = (projectId: string) => ({
  producerModule: 'shotgun-app',
  producerVersion: '1.0.0',
  projectId,
  actor: { type: 'service' as const, id: 'stage12-1-canonical-projection-recovery' },
  security: {
    accessScope: ['owner'],
    sensitivity: 'restricted' as const,
    dataClassification: 'canonical-recovery',
  },
});

export const runCanonicalProjectionRecovery = async (
  canonicalRepository: CanonicalKnowledgeRepositoryPort,
  connector: CanonicalProjectionRecoveryConnector,
  options: { readonly batchSize?: number; readonly maxBatchesPerProject?: number } = {},
): Promise<CanonicalProjectionRecoveryResult> => {
  const batchSize = options.batchSize ?? 100;
  const maxBatchesPerProject = options.maxBatchesPerProject ?? 10;
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new RangeError('Canonical recovery batchSize must be a positive integer.');
  }
  if (!Number.isInteger(maxBatchesPerProject) || maxBatchesPerProject < 1) {
    throw new RangeError('Canonical recovery maxBatchesPerProject must be a positive integer.');
  }
  const projects: CanonicalProjectionRecoveryProjectResult[] = [];

  for (const projectId of await canonicalRepository.listProjectIds()) {
    let outboxPublished = 0;
    let searchRebuilt = false;
    let compiledTruthRebuilt = false;
    try {
      for (let batch = 0; batch < maxBatchesPerProject; batch += 1) {
        const dispatched = await connector.sendCommand<{ published: number }>(
          createCommand({
            messageType: 'DispatchCanonicalOutbox',
            schemaVersion: '1.0.0',
            ...recoveryEnvelopeContext(projectId),
            idempotencyKey: `canonical-recovery:dispatch:${projectId}:${randomUUID()}`,
            payload: { limit: batchSize },
          }),
        );
        const published = dispatched.result.published;
        outboxPublished += published;
        if (published < batchSize) break;
      }

      let searchStatus = (
        await connector.query<ProjectionReadiness>(
          createQuery({
            messageType: 'GetProjectionReadiness',
            schemaVersion: '1.0.0',
            ...recoveryEnvelopeContext(projectId),
            payload: {},
          }),
        )
      ).result.payload;
      if (searchStatus.status !== 'READY') {
        await connector.sendCommand(
          createCommand({
            messageType: 'RebuildSearchProjection',
            schemaVersion: '1.0.0',
            ...recoveryEnvelopeContext(projectId),
            idempotencyKey: `canonical-recovery:search:${projectId}:${randomUUID()}`,
            payload: {},
          }),
        );
        searchRebuilt = true;
        searchStatus = (
          await connector.query<ProjectionReadiness>(
            createQuery({
              messageType: 'GetProjectionReadiness',
              schemaVersion: '1.0.0',
              ...recoveryEnvelopeContext(projectId),
              payload: {},
            }),
          )
        ).result.payload;
      }

      let compiledStatus = (
        await connector.query<CompiledTruthProjectionStatus>(
          createQuery({
            messageType: 'GetCompiledTruthStatus',
            schemaVersion: '1.0.0',
            ...recoveryEnvelopeContext(projectId),
            payload: {},
          }),
        )
      ).result.payload;
      if (compiledStatus.status !== 'READY') {
        await connector.sendCommand(
          createCommand({
            messageType: 'BuildCompiledTruth',
            schemaVersion: '1.0.0',
            ...recoveryEnvelopeContext(projectId),
            idempotencyKey: `canonical-recovery:compiled-truth:${projectId}:${randomUUID()}`,
            payload: { mode: 'FULL_REBUILD' },
          }),
        );
        compiledTruthRebuilt = true;
        compiledStatus = (
          await connector.query<CompiledTruthProjectionStatus>(
            createQuery({
              messageType: 'GetCompiledTruthStatus',
              schemaVersion: '1.0.0',
              ...recoveryEnvelopeContext(projectId),
              payload: {},
            }),
          )
        ).result.payload;
      }

      if (searchStatus.status !== 'READY' || compiledStatus.status !== 'READY') {
        throw new Error('Projection recovery did not reach READY state.');
      }
      projects.push({
        projectId,
        status: 'READY',
        outboxPublished,
        searchRebuilt,
        compiledTruthRebuilt,
      });
    } catch (error) {
      projects.push({
        projectId,
        status: 'FAILED',
        outboxPublished,
        searchRebuilt,
        compiledTruthRebuilt,
        error: error instanceof Error ? error.message : 'Canonical Projection recovery failed.',
      });
    }
  }

  return {
    projects,
    ready: projects.filter((project) => project.status === 'READY').length,
    failed: projects.filter((project) => project.status === 'FAILED').length,
  };
};

export const runCanonicalProjectionRecoveryWithReport = async (
  canonicalRepository: CanonicalKnowledgeRepositoryPort,
  connector: CanonicalProjectionRecoveryConnector,
  trigger: CanonicalProjectionRecoveryTrigger,
  reporter: CanonicalProjectionRecoveryReporterPort,
  options: { readonly batchSize?: number; readonly maxBatchesPerProject?: number } = {},
): Promise<CanonicalProjectionRecoveryReport> => {
  const startedAt = new Date().toISOString();
  try {
    const result = await runCanonicalProjectionRecovery(canonicalRepository, connector, options);
    const report: CanonicalProjectionRecoveryReport = {
      trigger,
      startedAt,
      completedAt: new Date().toISOString(),
      result: safeRecoveryResult(result),
      runStatus: 'COMPLETED',
    };
    await recordRecoveryReport(reporter, report);
    return report;
  } catch {
    const report: CanonicalProjectionRecoveryReport = {
      trigger,
      startedAt,
      completedAt: new Date().toISOString(),
      runStatus: 'FAILED',
      safeError: 'CANONICAL_PROJECTION_RECOVERY_FAILED',
    };
    await recordRecoveryReport(reporter, report);
    return report;
  }
};

export const startCanonicalProjectionRecoveryWorker = (
  canonicalRepository: CanonicalKnowledgeRepositoryPort,
  connector: CanonicalProjectionRecoveryConnector,
  intervalMs: number,
  reporter: CanonicalProjectionRecoveryReporterPort = new InMemoryCanonicalProjectionRecoveryReporter(),
) => {
  if (!Number.isFinite(intervalMs) || intervalMs < 1) {
    throw new RangeError('Canonical recovery interval must be at least one millisecond.');
  }
  let active: Promise<void> | undefined;
  let stopped = false;
  const tick = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (active) return active;
    const execution = runCanonicalProjectionRecoveryWithReport(
      canonicalRepository,
      connector,
      'PERIODIC',
      reporter,
    )
      .then(() => undefined)
      .finally(() => {
        if (active === execution) active = undefined;
      });
    active = execution;
    return execution;
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  return {
    tick,
    async stop() {
      stopped = true;
      clearInterval(timer);
      await active;
    },
  };
};

const trustedRequestContexts = new WeakMap<object, TrustedSecurityContext>();
const trustedPrincipalContexts = new WeakMap<object, TrustedPrincipalContext>();

const askPage = (): string => `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Shotgun Ask</title>
  <style>
    body{font-family:system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#172033}
    form{display:flex;gap:8px} input{flex:1;padding:12px} button{padding:12px 18px}
    article{margin-top:24px;padding:16px;border:1px solid #d9e0ea;border-radius:10px}
    small{color:#526173} .error{color:#a11} ul{padding-left:22px}
  </style>
</head>
<body>
  <h1>Shotgun Ask</h1>
  <p>승인된 Canonical Claim만 검색하며, 모든 답변에 원문 근거를 표시합니다.</p>
  <form id="ask-form">
    <input id="question" required placeholder="예: Milo의 몸무게는?">
    <button>질문</button>
  </form>
  <p id="state"></p><section id="answer"></section>
  <script>
    const form=document.querySelector('#ask-form');
    const state=document.querySelector('#state');
    const answer=document.querySelector('#answer');
    form.addEventListener('submit',async(event)=>{
      event.preventDefault(); answer.replaceChildren(); state.textContent='검색 중…';
      try {
        const csrfRes=await fetch('/auth/csrf');if(!csrfRes.ok)throw new Error('CSRF 갱신 실패');const csrf=(await csrfRes.json()).csrfToken;
        const response=await fetch('/ask/query',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrf},body:JSON.stringify({question:document.querySelector('#question').value})});
        const body=await response.json(); if(!response.ok) throw new Error(body.message||'요청 실패');
        const result=body.answer; state.textContent='Projection: '+result.readiness.status+' / 지연: '+result.readiness.lag;
        if(result.uncertainty){const p=document.createElement('p');p.className='error';p.textContent=result.uncertainty;answer.append(p);}
        result.statements.forEach(statement=>{
          const article=document.createElement('article');const p=document.createElement('p');p.textContent=statement.text;article.append(p);
          const list=document.createElement('ul');statement.citations.forEach(citation=>{const li=document.createElement('li');const link=document.createElement('a');link.href='/evidence/'+encodeURIComponent(citation.evidenceId);link.textContent='원문: '+citation.exactQuote;li.append(link);list.append(li);});article.append(list);answer.append(article);
        });
      } catch(error) { state.textContent=''; const p=document.createElement('p');p.className='error';p.textContent=error.message;answer.append(p); }
    });
  </script>
</body>
</html>`;

const knowledgePage = (): string => `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Shotgun Knowledge Graph</title>
  <style>
    body{font-family:system-ui,sans-serif;max-width:1000px;margin:40px auto;padding:0 20px;color:#172033}
    #graph{height:420px;border:1px solid #d9e0ea;border-radius:10px;margin:20px 0;background:#fbfcfe}
    table{width:100%;border-collapse:collapse;margin-top:20px}th,td{border:1px solid #d9e0ea;padding:9px;text-align:left}
    th{background:#f3f6fa}.warning{color:#9a5b00;font-weight:700}.muted{color:#526173}
  </style>
</head>
<body>
  <h1>Compiled Truth 그래프</h1>
  <p>승인된 지식을 2D 그래프로 보고, 화면을 사용할 수 없을 때도 같은 데이터의 목록·표를 확인합니다.</p>
  <p id="state" class="muted">불러오는 중…</p>
  <div id="graph" role="img" aria-label="승인된 지식의 2D 관계 그래프"></div>
  <h2>지식 목록·표 보기</h2>
  <table aria-label="승인된 지식 항목">
    <thead><tr><th>ID</th><th>유형</th><th>내용</th><th>시간 상태</th><th>근거</th></tr></thead>
    <tbody id="rows"></tbody>
  </table>
  <script src="/vendor/cytoscape.min.js"></script>
  <script>
    const state=document.querySelector('#state');const rows=document.querySelector('#rows');
    (async()=>{try{
      const csrfRes=await fetch('/auth/csrf');if(!csrfRes.ok)throw new Error('CSRF 갱신 실패');const csrf=(await csrfRes.json()).csrfToken;
      const response=await fetch('/compiled-truth/query',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrf},body:'{}'});
      const body=await response.json();if(!response.ok)throw new Error(body.message||'요청 실패');
      const {projection,status}=body;const graph=projection.graph;state.textContent='상태 '+status.status+' / 지연 '+status.lag+' / 항목 '+projection.items.length+'개 / 관계 '+graph.edges.length+'개';projection.items.forEach(item=>{const row=document.createElement('tr');[item.id,item.type,item.label,item.state,String(item.evidenceIds.length)].forEach(value=>{const cell=document.createElement('td');cell.textContent=value;row.append(cell);});rows.append(row);});window.cytoscape({container:document.querySelector('#graph'),elements:[...graph.nodes.map(node=>({data:{id:node.id,label:node.label,state:node.state}})),...graph.edges.map(edge=>({data:{id:edge.id,source:edge.from,target:edge.to,label:edge.relationType}}))],style:[{selector:'node',style:{label:'data(label)','background-color':'#4776e6','font-size':'11px','text-wrap':'wrap','text-max-width':'100px'}},{selector:'edge',style:{label:'data(label)','curve-style':'bezier','target-arrow-shape':'triangle','line-color':'#91a0b5','target-arrow-color':'#91a0b5','font-size':'9px'}}],layout:{name:'cose',animate:false}});
    }catch(error){state.textContent=error.message;state.className='warning';}})();
  </script>
</body>
</html>`;

const requestContext = (headers: SecurityHeaders) => {
  const context = trustedRequestContexts.get(headers as object);
  if (!context) {
    throw new ShotgunError({
      code: 'AUTHENTICATION_REQUIRED',
      safeMessage: 'Authentication is required.',
      module: 'shotgun-app',
      operation: 'trusted-request-context',
    });
  }
  return context;
};

const requireDurableManualDiscoveryRequest = (
  body: unknown,
  headers: SecurityHeaders,
): DiscoveryManualTriggerRequestV1 => {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ShotgunError({
      code: 'INVALID_REQUEST',
      safeMessage: 'Discovery run requires a durable request identity.',
      module: 'product-api',
      operation: 'manual-discovery-request',
    });
  }
  const input = body as Record<string, unknown>;
  const unknown = Object.keys(input).filter(
    (key) => !['requestId', 'commandId', 'requestedScanMode', 'mode'].includes(key),
  );
  if (unknown.length) {
    throw new ShotgunError({
      code: 'INVALID_REQUEST',
      safeMessage: 'Discovery run accepts only its durable request identity and scan mode.',
      module: 'product-api',
      operation: 'manual-discovery-request',
    });
  }
  const requestId = input.requestId ?? headers['x-idempotency-key'];
  if (typeof requestId !== 'string' || requestId.trim().length === 0 || requestId.length > 512) {
    throw new ShotgunError({
      code: 'INVALID_REQUEST',
      safeMessage: 'A stable requestId or x-idempotency-key is required.',
      module: 'product-api',
      operation: 'manual-discovery-request',
    });
  }
  const legacyMode = input.mode;
  const requestedScanMode =
    input.requestedScanMode ??
    (legacyMode === 'WEEKLY'
      ? 'FULL_SCAN'
      : legacyMode === 'INCREMENTAL'
        ? 'INCREMENTAL'
        : undefined);
  if (requestedScanMode !== 'INCREMENTAL' && requestedScanMode !== 'FULL_SCAN') {
    throw new ShotgunError({
      code: 'INVALID_REQUEST',
      safeMessage: 'requestedScanMode must be INCREMENTAL or FULL_SCAN.',
      module: 'product-api',
      operation: 'manual-discovery-request',
    });
  }
  const commandId = input.commandId ?? requestId;
  if (typeof commandId !== 'string' || commandId.trim().length === 0 || commandId.length > 512) {
    throw new ShotgunError({
      code: 'INVALID_REQUEST',
      safeMessage: 'commandId must be a stable non-empty string.',
      module: 'product-api',
      operation: 'manual-discovery-request',
    });
  }
  return {
    commandId: commandId.trim(),
    requestId: requestId.trim(),
    requestedScanMode,
  };
};

type DiscoveryScheduleConfigurationRequestV1 = {
  readonly scheduleId: string;
  readonly status: DiscoveryScheduleStatusV1;
  readonly timezone: string;
  readonly dayOfWeek: number;
  readonly localTime: string;
};

const requireDiscoveryScheduleConfigurationRequest = (
  body: unknown,
): DiscoveryScheduleConfigurationRequestV1 => {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ShotgunError({
      code: 'INVALID_REQUEST',
      safeMessage: 'Discovery schedule configuration must be an object.',
      module: 'product-api',
      operation: 'discovery-schedule-request',
    });
  }
  const input = body as Record<string, unknown>;
  const allowed = ['scheduleId', 'status', 'timezone', 'dayOfWeek', 'localTime'];
  const unknown = Object.keys(input).filter((key) => !allowed.includes(key));
  if (unknown.length || allowed.some((key) => input[key] === undefined)) {
    throw new ShotgunError({
      code: 'INVALID_REQUEST',
      safeMessage:
        'Discovery schedule accepts only scheduleId, status, timezone, dayOfWeek, and localTime.',
      module: 'product-api',
      operation: 'discovery-schedule-request',
    });
  }
  const textField = (key: string, maxLength: number): string => {
    const value = input[key];
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
      throw new ShotgunError({
        code: 'INVALID_REQUEST',
        safeMessage: `Discovery schedule ${key} must be a bounded non-empty string.`,
        module: 'product-api',
        operation: 'discovery-schedule-request',
      });
    }
    return value.trim();
  };
  const status = input.status;
  const dayOfWeek = input.dayOfWeek;
  if (status !== 'ENABLED' && status !== 'DISABLED') {
    throw new ShotgunError({
      code: 'INVALID_REQUEST',
      safeMessage: 'Discovery schedule status must be ENABLED or DISABLED.',
      module: 'product-api',
      operation: 'discovery-schedule-request',
    });
  }
  if (
    typeof dayOfWeek !== 'number' ||
    !Number.isInteger(dayOfWeek) ||
    dayOfWeek < 1 ||
    dayOfWeek > 7
  ) {
    throw new ShotgunError({
      code: 'INVALID_REQUEST',
      safeMessage: 'Discovery schedule dayOfWeek must be an ISO weekday from 1 to 7.',
      module: 'product-api',
      operation: 'discovery-schedule-request',
    });
  }
  return {
    scheduleId: textField('scheduleId', 256),
    status,
    timezone: textField('timezone', 128),
    dayOfWeek,
    localTime: textField('localTime', 5),
  };
};

const requestPrincipalContext = (headers: SecurityHeaders): TrustedPrincipalContext => {
  const context = trustedPrincipalContexts.get(headers as object);
  if (!context) {
    throw new ShotgunError({
      code: 'AUTHENTICATION_REQUIRED',
      safeMessage: 'Principal authentication is required.',
      module: 'shotgun-app',
      operation: 'trusted-principal-context',
    });
  }
  return context;
};

const requireSemanticProjectionRefreshRequest = (body: unknown): Record<string, never> => {
  if (body === undefined || body === null) return {};
  if (typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 0) {
    throw new ShotgunError({
      code: 'INVALID_REQUEST',
      safeMessage: 'Semantic projection refresh accepts only an empty server-owned request.',
      module: 'product-api',
      operation: 'semantic-projection-refresh-request',
    });
  }
  return {};
};

const requireActionPreviewRequest = (
  body: unknown,
): {
  readonly candidateId: string;
  readonly expectedRevision: number;
  readonly operationKey: string;
} => {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).length !== 3 ||
    !Object.keys(body).every((key) =>
      ['candidateId', 'expectedRevision', 'operationKey'].includes(key),
    )
  ) {
    throw new ShotgunError({
      code: 'ACTION_SERVER_BINDING_REQUIRED',
      safeMessage: 'Preview accepts only candidateId, expectedRevision, and operationKey.',
      module: 'shotgun-app',
      operation: 'validate-action-preview-request',
    });
  }
  const request = body as Record<string, unknown>;
  if (
    typeof request.candidateId !== 'string' ||
    !request.candidateId ||
    !Number.isInteger(request.expectedRevision) ||
    (request.expectedRevision as number) < 1 ||
    typeof request.operationKey !== 'string'
  ) {
    throw new ShotgunError({
      code: 'ACTION_SERVER_BINDING_REQUIRED',
      safeMessage: 'Preview request values are invalid.',
      module: 'shotgun-app',
      operation: 'validate-action-preview-request',
    });
  }
  return request as {
    readonly candidateId: string;
    readonly expectedRevision: number;
    readonly operationKey: string;
  };
};

const requireActionExecuteRequest = (body: unknown): { readonly approvalId: string } => {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    !Object.hasOwn(body, 'approvalId') ||
    typeof (body as { approvalId?: unknown }).approvalId !== 'string'
  ) {
    throw new ShotgunError({
      code: 'ACTION_SERVER_BINDING_REQUIRED',
      safeMessage: 'Execute accepts only approvalId.',
      module: 'shotgun-app',
      operation: 'validate-action-execute-request',
    });
  }
  return body as { readonly approvalId: string };
};

const parseCookie = (header: string | undefined, name: string): string | undefined =>
  header
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);

const isStateChanging = (method: string): boolean =>
  ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

const traceView = (kernel: ShotgunKernel, traceId: string) =>
  kernel.connector.traces.findByTraceId(traceId).map((record) => ({
    messageType: record.messageType,
    messageKind: record.messageKind,
    consumerModule: record.consumerModule,
    status: record.status,
    attemptNumber: record.attemptNumber,
  }));

const auditView = (kernel: ShotgunKernel, traceId: string) =>
  kernel.connector.audit.findByTraceId(traceId).map((record) => ({
    category: record.category,
    messageType: record.messageType,
    moduleId: record.moduleId,
    status: record.status,
  }));

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

const diffHtml = (segments: readonly TextDiffSegment[]): string =>
  segments
    .map((segment) => {
      const tag = segment.type === 'insert' ? 'ins' : segment.type === 'delete' ? 'del' : 'span';
      return `<${tag}>${escapeHtml(segment.value)}</${tag}>`;
    })
    .join('');

const reviewPage = (bundle: {
  readonly changeSet: DraftChangeSet;
  readonly comparison: ComparisonResult;
  readonly candidate: ClaimCandidate;
  readonly evidence: readonly EvidenceSpan[];
}): string => {
  const { changeSet, comparison, candidate, evidence } = bundle;
  const evidenceHtml = evidence
    .map(
      (item) =>
        `<li><code>${escapeHtml(item.evidenceId)}</code><blockquote>${escapeHtml(item.quote.exact)}</blockquote></li>`,
    )
    .join('');
  const activity = changeSet.decisions
    .map(
      (item) =>
        `<li>${escapeHtml(item.decision)} — ${escapeHtml(item.actor.id)} — ${escapeHtml(item.reason)}</li>`,
    )
    .join('');
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Shotgun Change Set Review</title>
  <style>
    body{font-family:system-ui,sans-serif;max-width:960px;margin:40px auto;padding:0 20px;color:#1f2937}
    section{border:1px solid #d1d5db;border-radius:12px;padding:18px;margin:16px 0}
    code{overflow-wrap:anywhere} ins{background:#dcfce7;text-decoration:none} del{background:#fee2e2}
    textarea{width:100%;min-height:90px;box-sizing:border-box} button{margin:8px 8px 0 0;padding:10px 16px}
    blockquote{border-left:4px solid #cbd5e1;margin-left:0;padding-left:12px}
  </style>
</head>
<body>
  <h1>Change Set Review</h1>
  <p>상태: <strong id="status">${escapeHtml(changeSet.status)}</strong></p>
  <section>
    <h2>후보 Claim</h2>
    <p>${escapeHtml(candidate.claimText)}</p>
    <p>분류: ${escapeHtml(comparison.classification)} / 작업: ${escapeHtml(changeSet.operation)}</p>
  </section>
  <section>
    <h2>고정 Canonical Snapshot</h2>
    <p>버전 ${changeSet.expectedCanonicalVersion}</p>
    <code>${escapeHtml(changeSet.snapshotDigest)}</code>
    <p>${comparison.matchedClaim ? escapeHtml(comparison.matchedClaim.text) : '일치 후보 없음'}</p>
  </section>
  <section>
    <h2>Machine Diff</h2>
    <p>${diffHtml(comparison.diff)}</p>
    <code>${escapeHtml(changeSet.diffDigest)}</code>
  </section>
  <section>
    <h2>Evidence</h2>
    <ul>${evidenceHtml}</ul>
  </section>
  <section>
    <h2>Activity</h2>
    <ul id="activity">${activity || '<li>아직 결정 없음</li>'}</ul>
  </section>
  <section>
    <h2>결정</h2>
    <textarea id="reason" placeholder="승인·보류·거절 이유를 입력하세요"></textarea>
    <div>
      <button data-decision="APPROVE">승인</button>
      <button data-decision="HOLD">보류</button>
      <button data-decision="REJECT">거절</button>
    </div>
    <p id="message"></p>
  </section>
  <script>
    const changeSetId = ${JSON.stringify(changeSet.changeSetId)};
    const expectedContentDigest = ${JSON.stringify(changeSet.contentDigest)};
    document.querySelectorAll('button[data-decision]').forEach((button) => {
      button.addEventListener('click', async () => {
        try {
          const csrfRes=await fetch('/auth/csrf');if(!csrfRes.ok)throw new Error('CSRF 갱신 실패');const csrf=(await csrfRes.json()).csrfToken;
          const response = await fetch('/reviews/decision', {
            method: 'POST',
            headers: {'content-type': 'application/json', 'x-csrf-token': csrf},
            body: JSON.stringify({
              changeSetId,
              expectedRevisionNumber: 1,
              expectedContentDigest,
              decision: button.dataset.decision,
              reason: document.querySelector('#reason').value
            })
          });
          const result = await response.json();
          document.querySelector('#message').textContent = response.ok
            ? '결정이 서버에 기록되었습니다.'
            : result.message;
          if (response.ok) document.querySelector('#status').textContent = result.changeSet.status;
        } catch (e) {
          document.querySelector('#message').textContent = e.message;
        }
      });
    });
  </script>
</body>
</html>`;
};

export const createApplication = async (options: ApplicationOptions = {}) => {
  const intakeRepository = options.intakeRepository ?? new InMemoryIntakeRepository();
  const originalAssetRepository =
    options.originalAssetRepository ?? new InMemoryOriginalAssetRepository();
  const assetStorage = options.assetStorage ?? new InMemoryAssetStorage();
  const transformationRepository =
    options.transformationRepository ?? new InMemoryTransformationRepository();
  const transformationRevisionSecurityRepository =
    options.transformationRevisionSecurityRepository ?? transformationRepository;
  const evidenceRepository = options.evidenceRepository ?? new InMemoryEvidenceRepository();
  const aiProviderRepository =
    options.aiProviderRepository ?? new InMemoryAIProviderCallRepository();
  const candidateRepository = options.candidateRepository ?? new InMemoryCandidateRepository();
  const validationRepository = options.validationRepository ?? new InMemoryValidationRepository();
  const comparisonRepository = options.comparisonRepository ?? new InMemoryComparisonRepository();
  const changeSetReviewRepository =
    options.changeSetReviewRepository ?? new InMemoryChangeSetReviewRepository();
  const canonicalKnowledgeRepository =
    options.canonicalKnowledgeRepository ?? new InMemoryCanonicalKnowledgeRepository();
  const searchProjectionRepository =
    options.searchProjectionRepository ?? new InMemorySearchProjectionRepository();
  const knowledgeModelRepository =
    options.knowledgeModelRepository ?? new InMemoryKnowledgeModelRepository();
  const typedPropositionConflictRuleRepository =
    options.typedPropositionConflictRuleRepository ??
    new InMemoryTypedPropositionConflictRuleRepository();
  const compiledTruthRepository =
    options.compiledTruthRepository ?? new InMemoryCompiledTruthRepository();
  const semanticCorpusSourceSnapshotReader =
    options.semanticCorpusSourceSnapshotReader ??
    new RepositorySemanticCorpusSourceSnapshotReader(
      canonicalKnowledgeRepository,
      knowledgeModelRepository,
      compiledTruthRepository,
    );
  const actionExecutionRepository =
    options.actionExecutionRepository ?? new InMemoryActionExecutionRepository();
  const canonicalProjectionRecoveryReporter =
    options.canonicalProjectionRecoveryReporter ??
    new InMemoryCanonicalProjectionRecoveryReporter();
  let latestCanonicalProjectionRecoveryReport: CanonicalProjectionRecoveryReport | undefined;
  const applicationCanonicalProjectionRecoveryReporter: CanonicalProjectionRecoveryReporterPort = {
    async report(value) {
      latestCanonicalProjectionRecoveryReport = value;
      await canonicalProjectionRecoveryReporter.report(value);
    },
  };
  const authRepository = options.authRepository ?? new InMemoryAuthRepository();
  // FE-P5-S2 WP2-C / WP5: ProjectTombstone + DeletedProjectAuditScope store for
  // authorized deleted-project audit reads.
  const projectTombstoneStore =
    options.projectTombstoneStore ?? new InMemoryProjectTombstoneStore();
  const projectAdminRepository =
    options.projectAdminRepository ??
    new InMemoryProjectAdministrationRepository(async ({ principalId, projectId }) => {
      if (!authRepository.createProjectOwnerMembership) {
        throw new Error('Authentication adapter does not support Project owner provisioning.');
      }
      await authRepository.createProjectOwnerMembership({
        principalId,
        projectId,
        scopes: ['owner'],
        sensitivityClearance: 'private',
      });
    });
  const settingsRepository = options.settingsRepository ?? new InMemorySettingsRepository();
  const frontendCommandGateway =
    options.frontendCommandGateway ?? new InMemoryFrontendCommandGateway();
  const discoveryFeedbackRepository =
    options.discoveryFeedbackRepository ?? new InMemoryDiscoveryFeedbackRepository();
  const frontendKnowledgeDraftRepository =
    options.frontendKnowledgeDraftRepository ?? new InMemoryFrontendKnowledgeDraftRepository();
  const frontendKnowledgeDraftTargetResolver =
    options.frontendKnowledgeDraftTargetResolver ??
    new InMemoryFrontendKnowledgeDraftTargetResolver();
  // FE-P5-XP Correction B: the Approval->Canonical commit consumer shares the
  // Review Approval store that issues KNOWLEDGE_CANONICAL_CHANGE Approvals and
  // the Canonical repository that owns commitFrontendDraft. The review store
  // exposes its Approval port transaction-scoped; the commit consumer reads
  // and consumes through its transaction boundary.
  const frontendReviewStore = options.frontendReviewStore ?? new InMemoryFrontendReviewStore();
  const reviewRepositoriesOn = (transaction: unknown) => {
    if (
      'repositoriesOn' in frontendReviewStore &&
      typeof frontendReviewStore.repositoriesOn === 'function'
    ) {
      return frontendReviewStore.repositoriesOn(transaction);
    }
    return undefined;
  };
  const discoveryRelationAuthority =
    options.frontendReviewAuthoringBridge !== undefined &&
    'revalidateRelation' in options.frontendReviewAuthoringBridge &&
    typeof options.frontendReviewAuthoringBridge.revalidateRelation === 'function'
      ? (options.frontendReviewAuthoringBridge as unknown as FrontendKnowledgeDraftDiscoveryRelationAuthorityPort)
      : undefined;
  const frontendKnowledgeDraftCoordinator =
    options.frontendKnowledgeDraftCoordinator ??
    new FrontendKnowledgeDraftProductCoordinator(
      frontendKnowledgeDraftRepository,
      frontendCommandGateway,
      frontendKnowledgeDraftTargetResolver,
      {
        approvals: {
          findByIdWithRevision: async (approvalId) =>
            frontendReviewStore.transaction((repositories) =>
              repositories.approvals.findByIdWithRevision(approvalId),
            ),
          findByIdWithRevisionInTransaction: async (transaction, approvalId) => {
            const repositories = reviewRepositoriesOn(transaction);
            return repositories?.approvals.findByIdWithRevision(approvalId);
          },
          consumeApproval: async (approvalId, canonicalCommitId, consumedAt, consumedBy) =>
            frontendReviewStore.transaction((repositories) =>
              repositories.approvals.consumeApproval(
                approvalId,
                canonicalCommitId,
                consumedAt,
                consumedBy,
              ),
            ),
          consumeApprovalInTransaction: async (
            transaction,
            approvalId,
            canonicalCommitId,
            consumedAt,
            consumedBy,
          ) => {
            const repositories = reviewRepositoriesOn(transaction);
            if (!repositories) {
              throw new Error('Review transaction joining is unavailable.');
            }
            return repositories.approvals.consumeApproval(
              approvalId,
              canonicalCommitId,
              consumedAt,
              consumedBy,
            );
          },
        },
        canonical: canonicalKnowledgeRepository,
        ...(discoveryRelationAuthority === undefined ? {} : { discoveryRelationAuthority }),
      },
    );
  const graphDiscoveryOverlayPort =
    options.graphDiscoveryOverlayPort ??
    createGraphDiscoveryOverlayPort({
      readFinding: async (scope, request) => {
        const context = scope.discoveryContext;
        if (!context || context.activeProject.id !== scope.activeProjectId) return undefined;
        const result = await frontendDiscoveryProductReadCoordinator.readFinding({
          principalId: scope.principalId,
          sessionId: scope.sessionId,
          activeProject: context.activeProject,
          accessibleProjects: context.accessibleProjects,
          accessRevision: scope.accessRevision,
          policyContextRevision: scope.policyContextRevision,
          accessScope: scope.accessScope,
          request: {
            schemaVersion: '1.0.0',
            findingId: request.findingId,
            findingRevision: request.findingRevision,
          },
        });
        return result.projectId === scope.activeProjectId ? result.finding : undefined;
      },
    });
  const graphReadDomain =
    options.graphReadDomain ??
    createGraphReadDomain({
      readPort: new Stage9GraphReadAdapter([], []),
      impactPort: new Stage9GraphReadAdapter([], []),
      snapshotContextStore: createInMemorySnapshotContextStore(),
      healthStore: createInMemoryHealthStore(),
      discoveryOverlayPort: graphDiscoveryOverlayPort,
    });
  // FE-P5-S2 WP3/WP5: Reversal draft creation is a change-set-review owned
  // capability (server-derived current capability + principal; the browser
  // only names the historical source revision). Round 4 Option 1: every
  // created candidate is persisted to the owning change-set-review store
  // (ADR-131 §4 owner = change-set-review; durable Reversal authority).
  const reversalEligibilityPort = createReversalEligibilityPort(canonicalKnowledgeRepository, {
    currentCapabilitiesResolver: async ({ resourceProjectId, principalId }) => {
      const membership = await authRepository.findMembership(principalId, resourceProjectId);
      return membership?.scopes ?? [];
    },
    // FE-P5-XP (WP-XP2): resolve the historical Review Approval that
    // authorized the source Canonical commit. Frontend commits carry
    // `authorityId = ReviewApproval.id` (commitFrontendDraft), so the
    // Reversal preserves that approval as EVIDENCE-ONLY evidence (never
    // authority) — the design's `historicalApprovalResolver` was defined but
    // never wired in the server composition (WP3 Round 1 fix B).
    historicalApprovalResolver: async (revision) => {
      const commit = await canonicalKnowledgeRepository.findCommit(
        revision.projectId,
        revision.commitId,
      );
      return commit?.authorityId ?? undefined;
    },
    reversalStore: changeSetReviewRepository,
  });
  const frontendReviewCoordinator =
    options.frontendReviewCoordinator ??
    new FrontendReviewProductCoordinator(
      frontendReviewStore,
      frontendCommandGateway,
      [
        new DraftReviewTargetAdapter(
          options.frontendReviewDraftSourceReader ??
            (frontendKnowledgeDraftRepository instanceof InMemoryFrontendKnowledgeDraftRepository
              ? createInMemoryReviewDraftSourceReader(frontendKnowledgeDraftRepository)
              : createEmptyReviewDraftSourceReader()),
        ),
        new DiscoveryCandidateReviewTargetAdapter(
          options.frontendReviewDiscoveryCandidateReader ??
            createInMemoryReviewDiscoveryCandidateReader(),
          options.discoveryReentryFreshnessEvaluator,
        ),
        new UserDirectiveReviewTargetAdapter(createInMemoryReviewUserDirectiveReader()),
      ],
      undefined,
      options.frontendReviewAuthoringBridge,
    );
  // FE-P4-S2 WP4: External Action governed commands run over the shared Frontend
  // Command Ledger; the server owns the Product Coordinator (server-derived
  // scope), the external action store and the connector engine.
  const externalActionStore =
    options.activityExternalActionBoundary ?? new InMemoryExternalActionStore();
  const frontendExternalActionCoordinator =
    options.frontendExternalActionCoordinator ??
    new FrontendExternalActionProductCoordinator(
      externalActionStore,
      frontendCommandGateway,
      new FakeExternalActionEngine(),
    );
  const inMemoryAskWorkspace = new InMemoryAskWorkspaceProjection();
  const askCommandCoordinator =
    options.askCommandCoordinator ??
    new AskCommandCoordinator(
      frontendCommandGateway,
      new InMemoryAskConversationRepository(),
      inMemoryAskWorkspace,
      undefined,
      options.askAnswerExecution,
    );
  const sourcesProjectionRepository =
    options.sourcesProjectionRepository ??
    ('listProjectSourceVersions' in originalAssetRepository &&
    typeof originalAssetRepository.listProjectSourceVersions === 'function'
      ? (originalAssetRepository as OriginalAssetRepositoryPort & SourcesProjectionRepositoryPort)
      : {
          async listProjectSourceVersions(): Promise<never> {
            throw new ShotgunError({
              code: 'CAPABILITY_DENIED',
              safeMessage: 'Sources projection is unavailable in this runtime.',
              module: 'frontend-sources-product',
              operation: 'list-source-versions',
            });
          },
        });
  const frontendSourcesReadCoordinator = new FrontendSourcesReadCoordinator(
    sourcesProjectionRepository,
    assetStorage,
    evidenceRepository,
  );
  // FE-P5-S1 WP3: the Activity Product API observes the owning Domains through
  // their concrete Activity adapters (Sources/Ask/External Action) into the
  // additive read model. The default runtime uses in-memory read ports/stores;
  // the persistent runtime (main.ts) injects the PostgreSQL ports/store. The
  // registry is assembled here at the composition boundary; Retry/Cancel are
  // NOT Activity commands (they stay on the owning-Domain routes).
  const activityReadModelStore =
    options.activityReadModelStore ?? createInMemoryActivityReadModelStore();
  const activitySourcesRead = options.activitySourcesRead ?? createInMemorySourcesActivityRead();
  const activityAskRead = options.activityAskRead ?? createInMemoryAskActivityRead();
  const activityDiscoveryRead =
    options.activityDiscoveryRead ?? createInMemoryDiscoveryActivityRead();
  const activityDiscoveryFindingRead = options.activityDiscoveryFindingRead;
  const activityCoordinator =
    options.activityCoordinator ??
    (() => {
      const registry = {
        adapters: [
          new SourcesActivityAdapter(activitySourcesRead),
          new AskActivityAdapter(activityAskRead),
          new DiscoveryActivityAdapter(activityDiscoveryRead, activityDiscoveryFindingRead),
          new ExternalActionActivityAdapter(externalActionStore),
        ],
        adapterFor(domainKind: 'SOURCES' | 'ASK' | 'EXTERNAL_ACTION' | 'DISCOVERY') {
          return registry.adapters.find((adapter) => adapter.domainKind === domainKind);
        },
        healthSummaries() {
          return Object.fromEntries(
            registry.adapters.map((adapter) => [adapter.adapterId, adapter.health()]),
          );
        },
      };
      const builder = new ActivityProjectionBuilder(registry, activityReadModelStore);
      return new ActivityProductCoordinator(registry, activityReadModelStore, builder);
    })();
  // FE-P5-S2 WP4: the History Workspace observes the owning Domains (Canonical,
  // Review, External Action, Policy) through their History adapters into the
  // additive federated History read model. Default runtime uses in-memory read
  // model + concrete read ports; the persistent runtime (main.ts) injects the
  // PostgreSQL store. Reversal creation is NOT a History route.
  const historyReadModelStore =
    options.historyReadModelStore ?? createInMemoryHistoryReadModelStore();
  const historyCoordinator =
    options.historyCoordinator ??
    (() => {
      const canonicalPayloadState =
        options.historyPayloadStates?.CANONICAL ?? new InMemoryPayloadStateStore('CANONICAL');
      const reviewPayloadState =
        options.historyPayloadStates?.REVIEW ?? new InMemoryPayloadStateStore('REVIEW');
      const externalActionPayloadState =
        options.historyPayloadStates?.EXTERNAL_ACTION ??
        new InMemoryPayloadStateStore('EXTERNAL_ACTION');
      const settingsPayloadState =
        options.historyPayloadStates?.SETTINGS ?? new InMemoryPayloadStateStore('SETTINGS');
      const policyHistoryRead = options.policyHistoryRead ?? new InMemoryPolicyHistoryReadAdapter();
      const reviewBoundary = options.historyReviewBoundary ?? new InMemoryFrontendReviewStore();
      const registry = createHistoryAdapterRegistry([
        new CanonicalHistoryAdapter(canonicalKnowledgeRepository, canonicalPayloadState),
        new ReviewHistoryAdapter(reviewBoundary, reviewPayloadState),
        new ExternalActionHistoryAdapter(externalActionStore, externalActionPayloadState),
        new PolicyHistoryAdapter(policyHistoryRead, settingsPayloadState),
      ]);
      return new HistoryProductCoordinator(historyReadModelStore.index, registry);
    })();
  const projectBootstrapUnitOfWork =
    options.projectBootstrapUnitOfWork ??
    (projectAdminRepository instanceof InMemoryProjectAdministrationRepository &&
    authRepository instanceof InMemoryAuthRepository
      ? new InMemoryProjectBootstrapUnitOfWork(projectAdminRepository, authRepository)
      : undefined);
  const actionCandidateRepository =
    options.actionCandidateRepository ?? new InMemoryActionCandidateRepository();
  const actionConnector = options.actionConnector ?? new FakeDraftActionConnector();
  const production = options.production ?? process.env.NODE_ENV === 'production';
  const testDevelopmentAuth =
    process.env.VITEST === 'true' && !options.authRepository && !production;
  let testPrincipal: Awaited<ReturnType<AuthRepositoryPort['authenticatePassword']>>;
  if (testDevelopmentAuth) {
    await authRepository.bootstrapOwner({
      accountId: 'test-owner',
      passwordHash: await hashPassword('test-owner-password'),
      projectId: 'shotgun',
      scopes: [
        'owner',
        'action:candidate:stage',
        'action:approve',
        'action:execute',
        'action:verify',
        'action:read',
        'action:audit:read',
      ],
      // Keep the test adapter aligned with the former no-header default.
      // Production never enables this adapter.
      sensitivityClearance: 'private',
    });
    testPrincipal = await authRepository.authenticatePassword('test-owner', 'test-owner-password');
  }
  const canonicalSnapshot = options.canonicalSnapshot ?? canonicalKnowledgeRepository;
  const textDiff = options.textDiff ?? new JsDiffAdapter();
  const aiProvider = options.aiProvider ?? new FakeAIProviderAdapter();
  const plainTextAdapter = new LucasAugmentedPlainTextAdapter();
  const transformer = options.transformer ?? new PythonDocumentFormatAdapter();
  const evidenceLocator = options.evidenceLocator ?? plainTextAdapter;
  const ping = createPingModule();
  const pong = createPongModule();
  const intake = createIntakeModule(intakeRepository);
  const originalAsset = createOriginalAssetModule(originalAssetRepository, assetStorage);
  const transformation = createTransformationModule(transformationRepository, transformer);
  const evidence = createEvidenceModule(evidenceRepository, evidenceLocator);
  const ai = createAIProviderModule(
    aiProviderRepository,
    aiProvider,
    options.aiProviderPolicy ?? {
      allowPrivate: aiProvider.identity.provider === 'fake',
      allowRestricted: false,
      maxAttempts: 2,
    },
  );
  const candidateGeneration = createCandidateGenerationModule(candidateRepository);
  const validation = createValidationModule(validationRepository);
  const comparison = createComparisonModule(comparisonRepository, canonicalSnapshot, textDiff);
  const changeSetReview = createChangeSetReviewModule(changeSetReviewRepository);
  const canonicalKnowledge = createCanonicalKnowledgeModule(canonicalKnowledgeRepository);
  const projectionSearch = createProjectionSearchModule(searchProjectionRepository);
  const citedAnswer = createCitedAnswerModule();
  const knowledgeModel = createKnowledgeModelModule(knowledgeModelRepository);
  const compiledTruth = createCompiledTruthModule(
    compiledTruthRepository,
    undefined,
    semanticCorpusSourceSnapshotReader,
  );
  const discoverySemanticIndexRepository =
    options.discoverySemanticIndexRepository ?? new InMemorySemanticIndexRepository();
  const discoveryRuntimeRepository =
    options.discoveryRuntimeRepository ?? new InMemoryDiscoveryRuntimeRepository();
  const discoverySource = new PostgresCanonicalCommittedSourceAdapter(
    canonicalKnowledgeRepository,
    semanticCorpusSourceSnapshotReader,
  );
  const discoveryTriggerCoordinator = new DiscoveryTriggerCoordinator(
    discoverySource,
    new PostgresDiscoveryProjectionReadinessAdapter(
      compiledTruthRepository,
      discoverySemanticIndexRepository,
    ),
    discoveryRuntimeRepository,
    options.discoveryTriggerPolicy ?? new StaticDiscoveryTriggerPolicy(),
    undefined,
    {
      currentAuthority: {
        resolve: (projectId) => discoverySource.resolveCurrentAuthority(projectId),
      },
    },
  );
  const discoveryScheduleRepository =
    options.discoveryScheduleRepository ?? new InMemoryDiscoveryScheduleRepository();
  // The same scheduler authority serves both the production worker and the
  // server-owned configuration boundary. The worker remains opt-in here so
  // tests and embedders can configure schedules without starting a timer.
  const discoveryScheduler = new PersistentDiscoveryScheduler(
    discoveryScheduleRepository,
    discoveryTriggerCoordinator,
  );
  const schedulerIntervalMs = options.discoverySchedulerIntervalMs;
  let discoverySchedulerWorker: { stop(): Promise<void> } | undefined;
  const discoveryExecutionWorker = options.discoveryExecutionWorker;
  const discoveryReentryWorker = options.discoveryReentryWorker;
  const discoveryTriggerCoordinatorModule = createDiscoveryTriggerCoordinatorModule(
    discoveryTriggerCoordinator,
  );
  const actionExecution = createActionExecutionModule(
    actionExecutionRepository,
    actionCandidateRepository,
    {
      resolveCurrentBinding: async (reference) => {
        const v = await validationRepository.findByValidationId(
          reference.projectId,
          reference.validationId,
        );
        if (!v || v.status !== 'READY' || v.dimensions.some((d) => d.status === 'FAIL')) {
          return undefined;
        }

        if (
          v.projectId !== reference.projectId ||
          v.validationId !== reference.validationId ||
          v.candidateId !== reference.actionCandidateId ||
          v.revisionNumber !== reference.expectedCandidateRevision
        ) {
          return undefined;
        }

        const freshEvidence = await Promise.all(
          reference.evidenceIds.map(
            async (e) => await evidenceRepository.findById(reference.projectId, e),
          ),
        );
        const resolved = freshEvidence.filter((e) => e !== undefined);
        if (resolved.length !== reference.evidenceIds.length) {
          return undefined;
        }

        const sourceVersion = await originalAssetRepository.findSourceVersionSecurity(
          reference.projectId,
          v.sourceVersionId,
        );
        const original = await originalAssetRepository.findByVersion(
          reference.projectId,
          v.sourceVersionId,
        );
        if (
          !sourceVersion ||
          !original ||
          !sourceVersion.contentHash ||
          sourceVersion.projectId !== reference.projectId ||
          sourceVersion.sourceVersionId !== v.sourceVersionId ||
          sourceVersion.originalAssetId !== original.assetReference.assetId ||
          sourceVersion.contentHash !== original.assetReference.contentHash ||
          sourceVersion.accessScope.length !== original.assetReference.accessScope.length ||
          !sourceVersion.accessScope.every((scope) =>
            original.assetReference.accessScope.includes(scope),
          ) ||
          sourceVersion.sensitivity !== original.sensitivity
        ) {
          return undefined;
        }

        const revisions = await Promise.all(
          resolved.map((e) =>
            transformationRevisionSecurityRepository.findTransformationRevisionSecurity(
              reference.projectId,
              e.revisionId,
            ),
          ),
        );

        for (const [index, e] of resolved.entries()) {
          const revision = revisions[index];
          if (
            !revision ||
            e.exactHash !== sha256Text(e.quote.exact) ||
            e.projectId !== reference.projectId ||
            e.sourceId !== sourceVersion.sourceId ||
            e.sourceVersionId !== sourceVersion.sourceVersionId ||
            e.sensitivity !== sourceVersion.sensitivity ||
            e.accessScope.length !== sourceVersion.accessScope.length ||
            !e.accessScope.every((scope) => sourceVersion.accessScope.includes(scope)) ||
            revision.revisionId !== e.revisionId ||
            revision.projectId !== reference.projectId ||
            revision.sourceId !== e.sourceId ||
            revision.sourceVersionId !== e.sourceVersionId ||
            revision.sourceVersionId !== v.sourceVersionId ||
            revision.sourceContentHash !== sourceVersion.contentHash ||
            revision.accessScope.length !== sourceVersion.accessScope.length ||
            !revision.accessScope.every((scope) => sourceVersion.accessScope.includes(scope)) ||
            revision.sensitivity !== sourceVersion.sensitivity
          ) {
            return undefined;
          }
        }

        const evBinding = resolved.map((e) => ({
          evidenceId: e.evidenceId,
          sourceId: e.sourceId,
          sourceVersionId: e.sourceVersionId,
          exactHash: e.exactHash,
          sensitivity: e.sensitivity,
          digest: actionEvidenceRecordDigest(e),
        }));
        const evidenceReferences = evBinding.map((e) => ({
          evidenceId: e.evidenceId,
          digest: e.digest,
        }));

        return {
          validation: {
            validationId: v.validationId,
            candidateId: v.candidateId,
            revisionNumber: v.revisionNumber,
            sourceVersionId: v.sourceVersionId,
            status: v.status,
            digest: validationResultDigest(v),
          },
          evidence: evBinding,
          evidenceSetDigest: actionEvidenceSetDigest(evidenceReferences),
          sourceVersionId: v.sourceVersionId,
          sourceSensitivity: sourceVersion.sensitivity,
        };
      },
    },
    actionConnector,
  );

  const lexicalRetriever = new LexicalRetriever(searchProjectionRepository, async (projectId) =>
    canonicalSnapshot.getSnapshot(projectId),
  );

  const knowledgeResourceResolver: KnowledgeResourceResolverPort =
    new ProductKnowledgeResourceResolver(
      canonicalKnowledgeRepository,
      knowledgeModelRepository,
      compiledTruthRepository,
    );

  const hybridRetrievalCoordinator =
    options.hybridRetrievalCoordinator ??
    new HybridRetrievalCoordinator(
      lexicalRetriever,
      options.semanticRetriever,
      knowledgeResourceResolver,
      {
        getEvidenceSpan: async (projectId, evidenceId) =>
          evidenceRepository.findById(projectId, evidenceId),
      },
      {
        getSourceVersion: async (projectId, sourceVersionId) => {
          const orig = await originalAssetRepository.findByVersion(projectId, sourceVersionId);
          if (!orig) return undefined;
          return {
            sourceVersionId,
            projectId: orig.projectId,
            sourceId: orig.sourceId,
          };
        },
      },
      options.semanticActiveGenerationReader,
    );

  const hybridRetrieval = createHybridRetrievalModule(hybridRetrievalCoordinator);

  const kernel = new ShotgunKernel(options.transport ?? new InProcessTransport());
  kernel.register(
    ping.module,
    pong.module,
    intake,
    originalAsset,
    transformation,
    evidence,
    ai,
    candidateGeneration,
    validation,
    comparison,
    changeSetReview,
    canonicalKnowledge,
    projectionSearch,
    citedAnswer,
    knowledgeModel,
    compiledTruth,
    discoveryTriggerCoordinatorModule,
    actionExecution,
    hybridRetrieval,
  );
  await kernel.start();
  const actionCenterProjection = new InMemoryActionCenterProjection(
    new CoordinatorActionCenterAttentionProjection(
      frontendReviewCoordinator,
      frontendExternalActionCoordinator,
      activityCoordinator,
    ),
  );
  const frontendProductReadCoordinator =
    options.frontendProductReadCoordinator ??
    options.frontendProductReadCoordinatorFactory?.(
      kernel.connector,
      actionCenterProjection,
      frontendSourcesReadCoordinator,
    ) ??
    new FrontendProductReadCoordinator(
      new InMemoryGlobalShellProjection(),
      actionCenterProjection,
      new InMemoryBackgroundSummaryProjection(),
      new InMemoryNotificationSummaryProjection(),
      new PostgresSourceLibraryGlobalSearch(frontendSourcesReadCoordinator),
      new InMemoryRouteGuardProjection(),
      inMemoryAskWorkspace,
    );
  const frontendDiscoveryProductReadCoordinator =
    options.frontendDiscoveryProductReadCoordinator ??
    new FrontendDiscoveryProductReadCoordinator(createEmptyDiscoveryProductReadSource());
  const discoveryFeedbackProductCoordinator =
    options.discoveryFeedbackProductCoordinator ??
    new DiscoveryFeedbackProductCoordinator(discoveryFeedbackRepository);
  // R3-1: the AI Durable Materialization Recovery mutates restored Product AI
  // durable execution state (markExpiredRunningAttemptsOutcomeUnknown / resume
  // commands), so the recovery harness must disable it and run ONLY the
  // Canonical Projection Recovery (ADR-097). The normal Product startup keeps
  // this recovery enabled (default `true`).
  if (options.aiDurableMaterializationRecoveryEnabled !== false) {
    await runAIDurableMaterializationRecovery(aiProviderRepository, kernel.connector);
  }
  await runCanonicalProjectionRecoveryWithReport(
    canonicalKnowledgeRepository,
    kernel.connector,
    'STARTUP',
    applicationCanonicalProjectionRecoveryReporter,
  );
  const canonicalProjectionRecoveryWorker =
    options.canonicalProjectionRecoveryIntervalMs === false
      ? undefined
      : startCanonicalProjectionRecoveryWorker(
          canonicalKnowledgeRepository,
          kernel.connector,
          options.canonicalProjectionRecoveryIntervalMs ?? 30_000,
          applicationCanonicalProjectionRecoveryReporter,
        );
  if (discoveryScheduler && schedulerIntervalMs !== undefined && schedulerIntervalMs !== false) {
    discoverySchedulerWorker = startPersistentDiscoverySchedulerWorker(
      discoveryScheduler,
      schedulerIntervalMs,
    );
  }
  discoveryExecutionWorker?.start();
  discoveryReentryWorker?.start();

  const server = Fastify({ logger: false });

  server.setErrorHandler(async (error, request, reply) => {
    const normalized =
      error instanceof ShotgunError
        ? error
        : new ShotgunError({
            code: 'INTERNAL_UNCLASSIFIED',
            safeMessage: 'Request failed.',
            module: 'product-api',
            operation: 'request',
            cause: error,
          });
    const descriptor = getFailureDescriptor(normalized.code);
    const context = trustedRequestContexts.get(request.headers as object);
    const principalContext = trustedPrincipalContexts.get(request.headers as object);
    try {
      await authRepository.appendAudit({
        principalId: context?.principalId ?? principalContext?.principalId,
        projectId: context?.projectId,
        event: `REQUEST_DENIED:${normalized.code}`,
      });
    } catch {
      // Do not replace a safe denial response with an audit-storage implementation error.
    }
    return reply.status(descriptor.httpStatus).send(
      createProductFailureEnvelope({
        code: normalized.code,
        message: normalized.safeMessage,
        ...(normalized.correlationId === undefined
          ? {}
          : { correlationId: normalized.correlationId }),
      }),
    );
  });

  const serverHost = options.host ?? process.env.HOST ?? '127.0.0.1';
  const isLoopbackBind = isLoopbackIp(serverHost);
  const legacyAuthEnabled =
    process.env.SHOTGUN_ENABLE_LEGACY_AUTH === 'true' &&
    process.env.NODE_ENV !== 'production' &&
    !production &&
    isLoopbackBind;

  const sessionCookieName = production ? '__Host-shotgun_session' : 'shotgun_session';

  const publicPaths = new Set([
    '/health',
    '/api/v1/session/local-bootstrap',
    ...(legacyAuthEnabled ? ['/auth/login'] : []),
  ]);
  /** LPA-WP4 (D04/D05): in launch mode (`spaDirectory` configured) the built
   *  SPA and its assets are public GET/HEAD browser routes served from the
   *  same origin. Reserved API namespaces and /health are NEVER bypassed — all
   *  authority stays server-derived and unknown API paths keep their existing
   *  failure semantics (LPA-AC-10). */
  const isSpaPublicRequest = (method: string, urlPath: string): boolean => {
    if (!options.spaDirectory) return false;
    if (method !== 'GET' && method !== 'HEAD') return false;
    if (
      urlPath === '/health' ||
      urlPath === '/api' ||
      urlPath.startsWith('/api/') ||
      urlPath === '/product-api' ||
      urlPath.startsWith('/product-api/')
    ) {
      return false;
    }
    return true;
  };
  server.addHook('onRequest', async (request) => {
    const urlPath = request.url.split('?')[0] ?? request.url;
    if (urlPath.startsWith('/auth/') && !legacyAuthEnabled) {
      throw new ShotgunError({
        code: 'NOT_FOUND',
        safeMessage: 'Not Found',
        module: 'shotgun-app',
        operation: 'legacy-auth',
      });
    }
    if (publicPaths.has(urlPath)) return;
    if (isSpaPublicRequest(request.method, urlPath)) return;
    const headers = request.headers as SecurityHeaders;
    for (const name of ['x-project-id', 'x-actor-id', 'x-access-scope', 'x-sensitivity'] as const) {
      if (headers[name] !== undefined) {
        throw new ShotgunError({
          code: 'LEGACY_SECURITY_HEADER_FORBIDDEN',
          safeMessage: 'Legacy security headers are forbidden.',
          module: 'shotgun-app',
          operation: 'authenticate-request',
        });
      }
    }

    const authorization = headers.authorization;
    const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    let context: TrustedSecurityContext | undefined;
    let principalContext: TrustedPrincipalContext | undefined;
    if (bearer) {
      const principal = await authRepository.findApiToken(bearer);
      const projectId = headers['x-shotgun-project']?.trim();
      if (!principal)
        throw new ShotgunError({
          code: 'AUTHENTICATION_INVALID',
          safeMessage: 'Credential is invalid, expired, or revoked.',
          module: 'shotgun-app',
          operation: 'authenticate-api-token',
        });
      if (!projectId)
        throw new ShotgunError({
          code: 'PROJECT_CONTEXT_REQUIRED',
          safeMessage: 'X-Shotgun-Project is required for API token requests.',
          module: 'shotgun-app',
          operation: 'select-project',
        });
      context = await authorize({
        repository: authRepository,
        principal,
        projectId,
        requiredScopes: [],
        tokenScopeCeiling: principal.scopeCeiling,
      });
      principalContext = {
        principalId: principal.principalId,
        actor: principal.actor,
        authenticationMethod: principal.authenticationMethod,
        credentialId: principal.credentialId,
      };
    } else {
      const sessionToken = parseCookie(headers.cookie, sessionCookieName);
      if (!sessionToken && testPrincipal) {
        context = await authorize({
          repository: authRepository,
          principal: testPrincipal,
          projectId: 'shotgun',
          requiredScopes: [],
        });
        principalContext = {
          principalId: testPrincipal.principalId,
          actor: testPrincipal.actor,
          authenticationMethod: testPrincipal.authenticationMethod,
          credentialId: testPrincipal.credentialId,
        };
      }
      if (!sessionToken && !context)
        throw new ShotgunError({
          code: 'AUTHENTICATION_REQUIRED',
          safeMessage: 'Authentication is required.',
          module: 'shotgun-app',
          operation: 'authenticate-session',
        });
      if (context) {
        trustedRequestContexts.set(request.headers as object, context);
        if (principalContext) {
          trustedPrincipalContexts.set(request.headers as object, principalContext);
        }
        return;
      }
      if (!sessionToken)
        throw new ShotgunError({
          code: 'AUTHENTICATION_REQUIRED',
          safeMessage: 'Authentication is required.',
          module: 'shotgun-app',
          operation: 'authenticate-session',
        });
      const session = await authRepository.findSession(sessionToken);
      const principal = session
        ? await authRepository.findPrincipal(session.principalId, 'session', session.sessionId)
        : undefined;
      if (!session || !principal)
        throw new ShotgunError({
          code: 'AUTHENTICATION_INVALID',
          safeMessage: 'Session is invalid, expired, or revoked.',
          module: 'shotgun-app',
          operation: 'authenticate-session',
        });
      if (isStateChanging(request.method)) {
        const csrf = headers['x-csrf-token'];
        if (!csrf || !session.csrfHash || hashSecuritySecret(csrf) !== session.csrfHash)
          throw new ShotgunError({
            code: 'REQUEST_ORIGIN_DENIED',
            safeMessage: 'A valid CSRF token is required.',
            module: 'shotgun-app',
            operation: 'verify-csrf',
          });
      }
      principalContext = {
        principalId: principal.principalId,
        actor: principal.actor,
        authenticationMethod: principal.authenticationMethod,
        credentialId: principal.credentialId,
      };
      if (session.activeProjectId === null) {
        const memberships = await authRepository.listMemberships(principal.principalId);
        if (memberships.length > 0) {
          throw new ShotgunError({
            code: 'LOCAL_PROJECT_SELECTION_REQUIRED',
            safeMessage:
              'Accessible Projects exist without an authoritative active Project selection.',
            module: 'shotgun-app',
            operation: 'authorize-zero-project-session',
          });
        }
      } else {
        context = await authorize({
          repository: authRepository,
          principal,
          projectId: session.activeProjectId,
          requiredScopes: [],
        });
      }
    }
    if (!principalContext)
      throw new ShotgunError({
        code: 'AUTHENTICATION_INVALID',
        safeMessage: 'Principal authentication is unavailable.',
        module: 'shotgun-app',
        operation: 'authenticate-principal',
      });
    if (!context && bearer)
      throw new ShotgunError({
        code: 'PROJECT_ACCESS_DENIED',
        safeMessage: 'Project membership or authorization is missing.',
        module: 'shotgun-app',
        operation: 'authorize-request',
      });
    trustedPrincipalContexts.set(request.headers as object, principalContext);
    if (context) {
      trustedRequestContexts.set(request.headers as object, context);
    }
    await authRepository.appendAudit({
      principalId: principalContext.principalId,
      projectId: context?.projectId,
      event: 'REQUEST_AUTHORIZED',
    });
  });

  const requirePrincipalBrowserSession = async (
    headers: SecurityHeaders,
  ): Promise<{
    readonly principalContext: TrustedPrincipalContext;
    readonly context?: TrustedSecurityContext;
    readonly sessionToken: string;
    readonly session: Awaited<ReturnType<AuthRepositoryPort['findSession']>> & {};
  }> => {
    const principalContext = requestPrincipalContext(headers);
    const context = trustedRequestContexts.get(headers as object);
    const sessionToken = parseCookie(headers.cookie, sessionCookieName);
    const session = sessionToken ? await authRepository.findSession(sessionToken) : undefined;
    if (principalContext.authenticationMethod === 'api_token' || !sessionToken || !session) {
      throw new ShotgunError({
        code: 'AUTHENTICATION_INVALID',
        safeMessage: 'Session is invalid, expired, or revoked.',
        module: 'shotgun-app',
        operation: 'require-product-session',
      });
    }
    return {
      principalContext,
      ...(context === undefined ? {} : { context }),
      sessionToken,
      session,
    };
  };

  const requireBrowserSession = async (
    headers: SecurityHeaders,
  ): Promise<{
    readonly principalContext: TrustedPrincipalContext;
    readonly context: TrustedSecurityContext;
    readonly sessionToken: string;
    readonly session: Awaited<ReturnType<AuthRepositoryPort['findSession']>> & {};
  }> => {
    const current = await requirePrincipalBrowserSession(headers);
    if (!current.context) {
      throw new ShotgunError({
        code: 'PROJECT_CONTEXT_REQUIRED',
        safeMessage: 'An active Project is required for this operation.',
        module: 'shotgun-app',
        operation: 'require-project-session',
      });
    }
    return { ...current, context: current.context };
  };

  const productSessionView = async (
    principalContext: TrustedPrincipalContext,
    projectContext: TrustedSecurityContext | undefined,
    sessionExpiresAt: string | null,
  ): Promise<ProductSessionView> =>
    createProductSessionView({
      principalContext,
      ...(projectContext === undefined ? {} : { projectContext }),
      sessionExpiresAt,
      memberships: await authRepository.listMemberships(principalContext.principalId),
    });

  const authenticationAdapter =
    options.authenticationAdapter ?? new LocalOwnerAuthenticationAdapter(authRepository);

  server.post('/api/v1/session/local-bootstrap', async (request, reply) => {
    const remoteIp = request.ip || request.socket.remoteAddress || '';
    const isRemoteLoopback = isLoopbackIp(remoteIp);
    const isSameOrigin = isSameOriginRequest(
      request.headers.origin,
      request.headers.referer,
      request.headers.host,
    );
    const localOwnerEnabled = process.env.SHOTGUN_DISABLE_LOCAL_OWNER !== 'true';

    const result = await authenticationAdapter.establishSession({
      isLoopbackBind,
      isRemoteLoopback,
      isSameOrigin,
      localOwnerEnabled,
    });

    if (result.status === 'authentication_unavailable') {
      await authRepository.appendAudit({ event: `LOCAL_BOOTSTRAP_FORBIDDEN:${result.code}` });
      throw new ShotgunError({
        code: 'PROJECT_ACCESS_DENIED',
        safeMessage: result.reason,
        module: 'shotgun-app',
        operation: 'bootstrap-local-owner',
      });
    }

    if (result.status === 'authentication_required') {
      throw new ShotgunError({
        code: 'AUTHENTICATION_REQUIRED',
        safeMessage: result.reason,
        module: 'shotgun-app',
        operation: 'bootstrap-local-owner',
      });
    }

    const { session, principalContext, context } = result;
    await authRepository.appendAudit({
      principalId: principalContext.principalId,
      projectId: context?.projectId,
      event: 'LOCAL_OWNER_SESSION_CREATED',
    });
    reply.header(
      'Set-Cookie',
      `${sessionCookieName}=${session.sessionToken}; HttpOnly; SameSite=Lax; Path=/${production ? '; Secure' : ''}`,
    );
    return {
      session: await productSessionView(principalContext, context, session.expiresAt),
    };
  });

  server.get<{ Headers: SecurityHeaders }>('/api/v1/session', async (request) => {
    const { principalContext, context, session } = await requirePrincipalBrowserSession(
      request.headers,
    );
    return {
      session: await productSessionView(principalContext, context, session.expiresAt),
    };
  });

  server.get<{ Headers: SecurityHeaders }>('/api/v1/security/csrf', async (request) => {
    const { sessionToken } = await requirePrincipalBrowserSession(request.headers);
    const newCsrf = randomUUID();
    await authRepository.updateSessionCsrf(sessionToken, newCsrf);
    return { csrfToken: newCsrf };
  });

  server.post<{ Body: { projectId: string }; Headers: SecurityHeaders }>(
    '/api/v1/session/active-project',
    async (request) => {
      const current = await requirePrincipalBrowserSession(request.headers);
      const membership = await authRepository.findMembership(
        current.principalContext.principalId,
        request.body.projectId,
      );
      if (!membership) {
        throw new ShotgunError({
          code: 'PROJECT_ACCESS_DENIED',
          safeMessage: 'Project access is denied.',
          module: 'shotgun-app',
          operation: 'product-set-active-project',
        });
      }
      const principal = await authRepository.findPrincipal(
        current.session.principalId,
        'session',
        current.session.sessionId,
      );
      const nextContext = principal
        ? await authorize({
            repository: authRepository,
            principal,
            projectId: request.body.projectId,
            requiredScopes: [],
          })
        : undefined;
      if (!nextContext) {
        throw new ShotgunError({
          code: 'PROJECT_ACCESS_DENIED',
          safeMessage: 'Project access is denied.',
          module: 'shotgun-app',
          operation: 'product-set-active-project',
        });
      }
      await authRepository.updateSessionProject(current.sessionToken, request.body.projectId);
      const refreshed = await authRepository.findSession(current.sessionToken);
      if (!refreshed) {
        throw new ShotgunError({
          code: 'AUTHENTICATION_INVALID',
          safeMessage: 'Session is invalid, expired, or revoked.',
          module: 'shotgun-app',
          operation: 'product-set-active-project',
        });
      }
      return {
        session: await productSessionView(
          current.principalContext,
          nextContext,
          refreshed.expiresAt,
        ),
      };
    },
  );

  server.post<{ Headers: SecurityHeaders }>('/api/v1/session/logout', async (request, reply) => {
    const sessionToken = parseCookie(request.headers.cookie, sessionCookieName);
    const context = trustedRequestContexts.get(request.headers as object);
    const principalContext = trustedPrincipalContexts.get(request.headers as object);
    if (sessionToken) {
      await authenticationAdapter.revokeSession(sessionToken);
    } else if (context?.principalId ?? principalContext?.principalId) {
      await authenticationAdapter.revokeSession(
        (context?.principalId ?? principalContext?.principalId)!,
      );
    }
    reply.header(
      'Set-Cookie',
      `${sessionCookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${production ? '; Secure' : ''}`,
    );
    return { message: 'Logged out' };
  });

  registerProjectRoutes(
    server,
    projectAdminRepository,
    settingsRepository,
    frontendCommandGateway,
    authRepository,
    requirePrincipalBrowserSession,
    projectBootstrapUnitOfWork,
  );
  registerFrontendProductRoutes(
    server,
    frontendProductReadCoordinator,
    authRepository,
    projectAdminRepository,
    settingsRepository,
    requirePrincipalBrowserSession,
    {
      askCommandCoordinator: options.askCommandCoordinator,
      askAnswerExecution: options.askAnswerExecution,
      frontendCommandGateway,
      discoveryFeedbackProductCoordinator,
      frontendSourcesReadCoordinator,
      frontendDiscoveryProductReadCoordinator,
      frontendDiscoveryFindingLifecycleService: options.frontendDiscoveryFindingLifecycleService,
    },
  );
  registerSourcesRoutes(
    server,
    frontendSourcesReadCoordinator,
    authRepository,
    settingsRepository,
    requirePrincipalBrowserSession,
  );
  registerSettingsRoutes(
    server,
    settingsRepository,
    frontendCommandGateway,
    authRepository,
    projectAdminRepository,
    requireBrowserSession,
  );
  registerTypedPropositionConflictRuleRoutes(
    server,
    typedPropositionConflictRuleRepository,
    settingsRepository,
    frontendCommandGateway,
    authRepository,
    requireBrowserSession,
  );
  if (options.aiSettingsBackend) {
    registerAISettingsRoutes(
      server,
      options.aiSettingsBackend,
      authRepository,
      requireBrowserSession,
      options.providerExternalTransferApprovals,
    );
  }
  registerFrontendKnowledgeDraftRoutes(
    server,
    frontendKnowledgeDraftCoordinator,
    authRepository,
    settingsRepository,
    requirePrincipalBrowserSession,
  );
  registerFrontendKnowledgeGraphRoutes(
    server,
    graphReadDomain,
    options.graphScopeResolver ??
      (async (headers) => {
        const current = await requirePrincipalBrowserSession(headers);
        const activeProjectId = current.session.activeProjectId;
        if (!activeProjectId) {
          throw new ShotgunError({
            code: 'PROJECT_CONTEXT_REQUIRED',
            safeMessage: 'Graph reads require an active Project.',
            module: 'frontend-knowledge-graph-api',
            operation: 'graph-scope',
          });
        }
        const membership = await authRepository.findMembership(
          current.principalContext.principalId,
          activeProjectId,
        );
        if (!membership) {
          throw new ShotgunError({
            code: 'PRECONDITION_ACCESS_DENIED',
            safeMessage: 'Principal is not a member of the active Project.',
            module: 'frontend-knowledge-graph-api',
            operation: 'graph-scope',
          });
        }
        const memberships = await authRepository.listMemberships(
          current.principalContext.principalId,
        );
        const projects = await projectAdminRepository.getProjects(
          memberships.map((candidate) => candidate.projectId),
        );
        const accessibleProjects = memberships.flatMap((candidate) => {
          const project = projects.projects.find((item) => item.id === candidate.projectId);
          return project
            ? [
                {
                  id: project.id,
                  label: project.name,
                  isOwner: candidate.isOwner,
                  sensitivityClearance: candidate.sensitivityClearance,
                },
              ]
            : [];
        });
        const activeProject = accessibleProjects.find((project) => project.id === activeProjectId);
        if (!activeProject) {
          throw new ShotgunError({
            code: 'PRECONDITION_ACCESS_DENIED',
            safeMessage: 'Principal is not in the active Project scope.',
            module: 'frontend-knowledge-graph-api',
            operation: 'graph-scope',
          });
        }
        return {
          principalId: current.principalContext.principalId,
          sessionId: current.session.sessionId,
          activeProjectId,
          accessRevision: `access:${activeProjectId}`,
          policyContextRevision: `policy:${activeProjectId}`,
          accessScope: membership.scopes,
          discoveryContext: { activeProject, accessibleProjects },
        };
      }),
  );
  registerFrontendReviewRoutes(
    server,
    frontendReviewCoordinator,
    reversalEligibilityPort,
    authRepository,
    settingsRepository,
    requirePrincipalBrowserSession,
    {
      frontendKnowledgeDraftRepository,
      canonicalKnowledgeRepository,
      changeSetReviewRepository,
    },
  );
  registerFrontendExternalActionRoutes(
    server,
    frontendExternalActionCoordinator,
    authRepository,
    settingsRepository,
    requirePrincipalBrowserSession,
  );
  registerActivityRoutes(
    server,
    activityCoordinator,
    authRepository,
    settingsRepository,
    requirePrincipalBrowserSession,
  );
  registerHistoryRoutes(
    server,
    historyCoordinator,
    projectTombstoneStore,
    authRepository,
    settingsRepository,
    requirePrincipalBrowserSession,
  );

  server.post<{ Body: { accountId: string; password: string; projectId: string } }>(
    '/auth/login',
    async (request, reply) => {
      const principal = await authRepository.authenticatePassword(
        request.body.accountId,
        request.body.password,
      );
      if (!principal) {
        await authRepository.appendAudit({ event: 'LOGIN_DENIED' });
        throw new ShotgunError({
          code: 'AUTHENTICATION_INVALID',
          safeMessage: 'Credential is invalid.',
          module: 'shotgun-app',
          operation: 'login',
        });
      }
      const context = await authorize({
        repository: authRepository,
        principal,
        projectId: request.body.projectId,
        requiredScopes: [],
      });
      if (!context)
        throw new ShotgunError({
          code: 'PROJECT_ACCESS_DENIED',
          safeMessage: 'Project membership is missing.',
          module: 'shotgun-app',
          operation: 'login',
        });
      const session = await authRepository.createSession(
        principal.principalId,
        context.projectId,
        new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
      );
      await authRepository.appendAudit({
        principalId: principal.principalId,
        projectId: context.projectId,
        event: 'LOGIN_SUCCEEDED',
      });
      reply.header(
        'Set-Cookie',
        `${sessionCookieName}=${session.sessionToken}; HttpOnly; SameSite=Lax; Path=/${production ? '; Secure' : ''}`,
      );
      return {
        csrfToken: session.csrfToken,
        projectId: context.projectId,
        principalId: principal.principalId,
      };
    },
  );

  server.get('/auth/csrf', async (request, reply) => {
    const sessionToken = parseCookie(request.headers.cookie, sessionCookieName);
    if (!sessionToken) return reply.status(401).send({ message: 'Authentication required' });
    const session = await authRepository.findSession(sessionToken);
    if (!session) return reply.status(401).send({ message: 'Session invalid' });
    const newCsrf = randomUUID();
    await authRepository.updateSessionCsrf(sessionToken, newCsrf);
    return { csrfToken: newCsrf };
  });

  server.post<{ Headers: SecurityHeaders }>('/auth/logout', async (request, reply) => {
    const context = requestContext(request.headers);
    if (context.authenticationMethod === 'session') {
      await authRepository.revokeSessions(context.principalId);
    }
    reply.header(
      'Set-Cookie',
      `${sessionCookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${production ? '; Secure' : ''}`,
    );
    return { message: 'Logged out' };
  });

  server.get<{ Headers: SecurityHeaders }>('/auth/principal', async (request) => {
    const context = requestContext(request.headers);
    return { principalId: context.principalId, actor: context.actor };
  });

  server.get<{ Headers: SecurityHeaders }>('/auth/projects', async (request) => {
    const context = requestContext(request.headers);
    const memberships = await authRepository.listMemberships(context.principalId);
    return { projects: memberships.map((m) => m.projectId) };
  });

  server.post<{ Body: { projectId: string }; Headers: SecurityHeaders }>(
    '/auth/projects/active',
    async (request) => {
      const context = requestContext(request.headers);
      const membership = await authRepository.findMembership(
        context.principalId,
        request.body.projectId,
      );
      if (!membership)
        throw new ShotgunError({
          code: 'PROJECT_ACCESS_DENIED',
          safeMessage: 'Access denied.',
          module: 'shotgun-app',
          operation: 'set-active-project',
        });
      const sessionToken = parseCookie(request.headers.cookie, sessionCookieName);
      if (sessionToken) {
        await authRepository.updateSessionProject(sessionToken, request.body.projectId);
      }
      return { projectId: request.body.projectId };
    },
  );

  server.post<{ Body: { currentPassword: string; newPassword: string }; Headers: SecurityHeaders }>(
    '/auth/password',
    async (request) => {
      const context = requestContext(request.headers);
      const valid = await authRepository.verifyCurrentPassword(
        context.principalId,
        request.body.currentPassword,
      );
      if (!valid)
        throw new ShotgunError({
          code: 'AUTHENTICATION_INVALID',
          safeMessage: 'Invalid current password.',
          module: 'shotgun-app',
          operation: 'change-password',
        });
      const passwordHash = await hashPassword(request.body.newPassword);
      await authRepository.changePassword(context.principalId, passwordHash);
      return { message: 'Password updated' };
    },
  );

  server.post<{ Headers: SecurityHeaders }>('/auth/account/disable', async (request) => {
    const context = requestContext(request.headers);
    await authRepository.disablePrincipal(context.principalId);
    return { message: 'Account disabled' };
  });

  server.post<{ Headers: SecurityHeaders }>('/auth/sessions/revoke', async (request) => {
    const context = requestContext(request.headers);
    await authRepository.revokeSessions(context.principalId);
    return { message: 'Sessions revoked' };
  });

  server.post<{ Body: { scopes: string[]; expiresAt: string }; Headers: SecurityHeaders }>(
    '/auth/tokens',
    async (request) => {
      const context = requestContext(request.headers);
      if (!context.projectId)
        throw new ShotgunError({
          code: 'PROJECT_CONTEXT_REQUIRED',
          safeMessage: 'A project context is required.',
          module: 'shotgun-app',
          operation: 'issue-api-token',
        });
      if (!context.security.accessScope.includes('auth:token:issue'))
        throw new ShotgunError({
          code: 'AUTHORIZATION_DENIED',
          safeMessage: 'Missing auth:token:issue scope.',
          module: 'shotgun-app',
          operation: 'issue-api-token',
        });
      const membership = await authRepository.findMembership(
        context.principalId,
        context.projectId,
      );
      if (!membership)
        throw new ShotgunError({
          code: 'PROJECT_ACCESS_DENIED',
          safeMessage: 'Access denied.',
          module: 'shotgun-app',
          operation: 'issue-api-token',
        });

      const requestedScopes = [...new Set(request.body.scopes)];
      if (requestedScopes.length === 0) {
        throw new ShotgunError({
          code: 'VALIDATION_ERROR',
          safeMessage: 'At least one scope is required.',
          module: 'shotgun-app',
          operation: 'issue-api-token',
        });
      }

      const allowedScopes = new Set(membership.scopes);
      const currentScopes = new Set(context.security.accessScope);
      for (const scope of requestedScopes) {
        if (!allowedScopes.has(scope) || !currentScopes.has(scope)) {
          throw new ShotgunError({
            code: 'AUTHORIZATION_DENIED',
            safeMessage: `Scope ${scope} exceeds permitted ceiling.`,
            module: 'shotgun-app',
            operation: 'issue-api-token',
          });
        }
      }

      const maxExpiry = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
      const requestedExpiry = new Date(request.body.expiresAt);
      if (
        isNaN(requestedExpiry.getTime()) ||
        requestedExpiry > maxExpiry ||
        requestedExpiry <= new Date()
      ) {
        throw new ShotgunError({
          code: 'VALIDATION_ERROR',
          safeMessage: 'Invalid or excessive expiry date.',
          module: 'shotgun-app',
          operation: 'issue-api-token',
        });
      }

      const token = await authRepository.issueApiToken({
        principalId: context.principalId,
        scopes: requestedScopes,
        expiresAt: requestedExpiry.toISOString(),
      });
      return token;
    },
  );

  server.post<{ Headers: SecurityHeaders }>('/auth/tokens/revoke', async (request) => {
    const context = requestContext(request.headers);
    await authRepository.revokeApiTokens(context.principalId);
    return { message: 'Tokens revoked' };
  });

  server.get<{ Headers: SecurityHeaders }>('/auth/tokens', async (request) => {
    const context = requestContext(request.headers);
    const tokens = await authRepository.listApiTokens(context.principalId);
    return { tokens };
  });

  server.get('/health', async () => kernel.health());

  server.post<{ Body: PingRequest }>('/demo/ping', async (request) => {
    const requestId = request.body?.requestId ?? randomUUID();
    const context = requestContext(request.headers as SecurityHeaders);
    const command = createCommand({
      messageType: 'PingCommand',
      schemaVersion: '1.0.0',
      producerModule: 'shotgun-app',
      producerVersion: '1.0.0',
      idempotencyKey: `ping:${requestId}`,
      ...context,
      payload: {
        requestId,
        message: request.body?.message ?? 'hello',
        sequence: 1,
      },
    });

    const commandDelivery = await kernel.connector.sendCommand(command);
    const query = createChildQuery(command, {
      messageType: 'GetPongResult',
      schemaVersion: '1.0.0',
      producerModule: 'shotgun-app',
      producerVersion: '1.0.0',
      payload: { requestId },
    });
    const queryDelivery = await kernel.connector.query(query);

    return {
      commandStatus: commandDelivery.status,
      pong: queryDelivery.result.payload,
      trace: traceView(kernel, command.traceId),
    };
  });

  server.post<{ Body: SubmitIntakePayload; Headers: SecurityHeaders }>(
    '/intake',
    async (request) => {
      const context = requestContext(request.headers);
      const command = createCommand({
        messageType: 'SubmitIntake',
        schemaVersion: '1.0.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        idempotencyKey: `intake:${context.projectId}:${request.body.submissionId}`,
        ...context,
        payload: request.body,
      });
      const commandDelivery = await kernel.connector.sendCommand(command);
      const resultQuery = createChildQuery(command, {
        messageType: 'GetIntakeResult',
        schemaVersion: '1.0.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        payload: { submissionId: request.body.submissionId },
      });
      const stored = await kernel.connector.query(resultQuery);
      const storedPayload = stored.result.payload as { readonly sourceVersionId: string };
      const document = await kernel.connector.query(
        createChildQuery(command, {
          messageType: 'GetDocumentRevision',
          schemaVersion: '1.0.0',
          producerModule: 'shotgun-app',
          producerVersion: '1.0.0',
          payload: { sourceVersionId: storedPayload.sourceVersionId },
        }),
      );
      const evidence = await kernel.connector.query(
        createChildQuery(command, {
          messageType: 'ListEvidenceSpans',
          schemaVersion: '1.0.0',
          producerModule: 'shotgun-app',
          producerVersion: '1.0.0',
          payload: { sourceVersionId: storedPayload.sourceVersionId },
        }),
      );
      const candidates = await kernel.connector.query(
        createChildQuery(command, {
          messageType: 'ListClaimCandidates',
          schemaVersion: '1.0.0',
          producerModule: 'shotgun-app',
          producerVersion: '1.0.0',
          payload: { sourceVersionId: storedPayload.sourceVersionId },
        }),
      );
      const reviews = await kernel.connector.query(
        createChildQuery(command, {
          messageType: 'ListDraftChangeSets',
          schemaVersion: '1.0.0',
          producerModule: 'shotgun-app',
          producerVersion: '1.0.0',
          payload: { sourceVersionId: storedPayload.sourceVersionId },
        }),
      );
      return {
        commandStatus: commandDelivery.status,
        intake: commandDelivery.result,
        stored: stored.result.payload,
        document: document.result.payload,
        evidence: evidence.result.payload,
        candidates: candidates.result.payload,
        reviews: reviews.result.payload,
        trace: traceView(kernel, command.traceId),
        audit: auditView(kernel, command.traceId),
      };
    },
  );

  server.post<{ Body: ComparisonRequest; Headers: SecurityHeaders }>(
    '/comparisons/resolve',
    async (request) => {
      const query = createQuery({
        messageType: 'GetComparisonResult',
        schemaVersion: '1.0.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        ...requestContext(request.headers),
        payload: request.body,
      });
      const delivery = await kernel.connector.query<ComparisonResult>(query);
      return { comparison: delivery.result.payload };
    },
  );

  server.post<{ Body: ChangeSetRequest; Headers: SecurityHeaders }>(
    '/reviews/resolve',
    async (request) => {
      const query = createQuery({
        messageType: 'GetReviewBundle',
        schemaVersion: '1.0.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        ...requestContext(request.headers),
        payload: request.body,
      });
      const delivery = await kernel.connector.query(query);
      return { review: delivery.result.payload };
    },
  );

  server.post<{ Body: Record<string, never>; Headers: SecurityHeaders }>(
    '/canonical/snapshot',
    async (request) => {
      const delivery = await kernel.connector.query<CanonicalSnapshot>(
        createQuery({
          messageType: 'GetCanonicalSnapshot',
          schemaVersion: '1.0.0',
          producerModule: 'shotgun-app',
          producerVersion: '1.0.0',
          ...requestContext(request.headers),
          payload: request.body ?? {},
        }),
      );
      return { snapshot: delivery.result.payload };
    },
  );

  server.post<{ Body: SearchRequest; Headers: SecurityHeaders }>('/search', async (request) => {
    const delivery = await kernel.connector.query<CanonicalSearchResponse>(
      createQuery({
        messageType: 'SearchCanonicalKnowledge',
        schemaVersion: '1.0.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        ...requestContext(request.headers),
        payload: request.body,
      }),
    );
    return { search: delivery.result.payload };
  });

  server.post<{ Body: HybridSearchRequest; Headers: SecurityHeaders }>(
    '/search/hybrid',
    async (request) => {
      const delivery = await kernel.connector.query<HybridSearchResponse>(
        createQuery({
          messageType: 'SearchHybridKnowledge',
          schemaVersion: '1.0.0',
          producerModule: 'shotgun-app',
          producerVersion: '1.0.0',
          ...requestContext(request.headers),
          payload: request.body,
        }),
      );
      return { hybridSearch: delivery.result.payload };
    },
  );

  server.post<{ Body: AskRequest; Headers: SecurityHeaders }>('/ask/query', async (request) => {
    const delivery = await kernel.connector.query<CitedAnswer>(
      createQuery({
        messageType: 'AskCanonicalKnowledge',
        schemaVersion: '1.0.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        ...requestContext(request.headers),
        payload: request.body,
      }),
    );
    return { answer: delivery.result.payload };
  });

  server.post<{ Body: Record<string, never>; Headers: SecurityHeaders }>(
    '/projection/readiness',
    async (request) => {
      const delivery = await kernel.connector.query(
        createQuery({
          messageType: 'GetProjectionReadiness',
          schemaVersion: '1.0.0',
          producerModule: 'shotgun-app',
          producerVersion: '1.0.0',
          ...requestContext(request.headers),
          payload: request.body ?? {},
        }),
      );
      return { readiness: delivery.result.payload };
    },
  );

  server.post<{ Body: Record<string, never>; Headers: SecurityHeaders }>(
    '/projection/rebuild',
    async (request) => {
      const context = requestContext(request.headers);
      const command = createCommand({
        messageType: 'RebuildSearchProjection',
        schemaVersion: '1.0.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        idempotencyKey: `projection-rebuild:${context.projectId}:${randomUUID()}`,
        ...context,
        payload: request.body ?? {},
      });
      const delivery = await kernel.connector.sendCommand(command);
      return { commandStatus: delivery.status, result: delivery.result };
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/projection/semantic/refresh',
    async (request) => {
      const context = requestContext(request.headers);
      requireSemanticProjectionRefreshRequest(request.body);
      if (!options.semanticProjectionRefresh) {
        throw new ShotgunError({
          code: 'CONFIGURATION_REQUIRED',
          safeMessage: 'Semantic projection refresh is not configured.',
          module: 'product-api',
          operation: 'semantic-projection-refresh',
        });
      }
      const result = await options.semanticProjectionRefresh.refresh({
        projectId: context.projectId,
        actor: context.actor,
        security: context.security,
      });
      return { refresh: result };
    },
  );

  // The built Product SPA owns /ask in launch mode. Keep the legacy cited-claim
  // page only for non-SPA integration/diagnostic hosts that do not serve Product routes.
  if (!options.spaDirectory) {
    server.get('/ask', async (_request, reply) =>
      reply.type('text/html; charset=utf-8').send(askPage()),
    );
  }

  server.get<{ Params: EvidenceRequest; Headers: SecurityHeaders }>(
    '/evidence/:evidenceId',
    async (request, reply) => {
      const delivery = await kernel.connector.query<EvidenceSpan>(
        createQuery({
          messageType: 'GetEvidenceSpan',
          schemaVersion: '1.0.0',
          producerModule: 'shotgun-app',
          producerVersion: '1.0.0',
          ...requestContext(request.headers),
          payload: request.params,
        }),
      );
      const span = delivery.result.payload;
      return reply
        .type('text/html; charset=utf-8')
        .send(
          `<!doctype html><html lang="ko"><meta charset="utf-8"><title>Evidence</title><body><h1>원문 근거</h1><blockquote>${escapeHtml(span.quote.exact)}</blockquote><dl><dt>Evidence ID</dt><dd>${escapeHtml(span.evidenceId)}</dd><dt>Source Version</dt><dd>${escapeHtml(span.sourceVersionId)}</dd><dt>Pointer</dt><dd>${escapeHtml(span.pointer)}</dd></dl></body></html>`,
        );
    },
  );

  server.post<{ Body: CanonicalClaimRequest; Headers: SecurityHeaders }>(
    '/canonical/claims/resolve',
    async (request) => {
      const delivery = await kernel.connector.query(
        createQuery({
          messageType: 'GetCanonicalClaim',
          schemaVersion: '1.0.0',
          producerModule: 'shotgun-app',
          producerVersion: '1.0.0',
          ...requestContext(request.headers),
          payload: request.body,
        }),
      );
      return { claim: delivery.result.payload };
    },
  );

  server.post<{ Body: CanonicalCommitRequest; Headers: SecurityHeaders }>(
    '/canonical/commits/resolve',
    async (request) => {
      const delivery = await kernel.connector.query<CanonicalCommitResult>(
        createQuery({
          messageType: 'GetCanonicalCommit',
          schemaVersion: '1.0.0',
          producerModule: 'shotgun-app',
          producerVersion: '1.0.0',
          ...requestContext(request.headers),
          payload: request.body,
        }),
      );
      return { commit: delivery.result.payload };
    },
  );

  server.post<{ Body: Record<string, never>; Headers: SecurityHeaders }>(
    '/canonical/history',
    async (request) => {
      const delivery = await kernel.connector.query<{ items: readonly CanonicalHistoryEvent[] }>(
        createQuery({
          messageType: 'ListCanonicalHistory',
          schemaVersion: '1.0.0',
          producerModule: 'shotgun-app',
          producerVersion: '1.0.0',
          ...requestContext(request.headers),
          payload: request.body ?? {},
        }),
      );
      return { history: delivery.result.payload };
    },
  );

  server.get<{ Params: ChangeSetRequest; Headers: SecurityHeaders }>(
    '/reviews/:changeSetId',
    async (request, reply) => {
      const query = createQuery({
        messageType: 'GetReviewBundle',
        schemaVersion: '1.0.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        ...requestContext(request.headers),
        payload: request.params,
      });
      const delivery = await kernel.connector.query<{
        changeSet: DraftChangeSet;
        comparison: ComparisonResult;
        candidate: ClaimCandidate;
        evidence: readonly EvidenceSpan[];
      }>(query);
      return reply.type('text/html; charset=utf-8').send(reviewPage(delivery.result.payload));
    },
  );

  server.post<{ Body: ReviewDecisionRequest; Headers: SecurityHeaders }>(
    '/reviews/decision',
    async (request) => {
      const decisionId = request.body.decisionId ?? randomUUID();
      const command = createCommand({
        messageType: 'RecordReviewDecision',
        schemaVersion: '1.0.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        idempotencyKey: `review-decision:${requestContext(request.headers).projectId}:${decisionId}`,
        ...requestContext(request.headers),
        payload: { ...request.body, decisionId },
      });
      const delivery = await kernel.connector.sendCommand<{
        changeSet: DraftChangeSet;
        manifest?: ApprovedChangeSetManifest;
      }>(command);
      return {
        commandStatus: delivery.status,
        changeSet: delivery.result.changeSet,
        manifest: delivery.result.manifest,
      };
    },
  );

  server.post<{ Body: SourceVersionRequest; Headers: SecurityHeaders }>(
    '/candidates/list',
    async (request) => {
      const query = createQuery({
        messageType: 'ListClaimCandidates',
        schemaVersion: '1.0.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        ...requestContext(request.headers),
        payload: request.body,
      });
      const delivery = await kernel.connector.query(query);
      return {
        candidates: delivery.result.payload,
        trace: traceView(kernel, query.traceId),
        audit: auditView(kernel, query.traceId),
      };
    },
  );

  server.post<{ Body: CandidateRequest; Headers: SecurityHeaders }>(
    '/validation/resolve',
    async (request) => {
      const query = createQuery({
        messageType: 'GetValidationResult',
        schemaVersion: '1.0.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        ...requestContext(request.headers),
        payload: request.body,
      });
      const delivery = await kernel.connector.query(query);
      return {
        validation: delivery.result.payload,
        trace: traceView(kernel, query.traceId),
        audit: auditView(kernel, query.traceId),
      };
    },
  );

  server.post<{ Body: SourceVersionRequest; Headers: SecurityHeaders }>(
    '/documents/resolve',
    async (request) => {
      const query = createQuery({
        messageType: 'GetDocumentRevision',
        schemaVersion: '1.0.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        ...requestContext(request.headers),
        payload: request.body,
      });
      const delivery = await kernel.connector.query(query);
      return {
        document: delivery.result.payload,
        trace: traceView(kernel, query.traceId),
        audit: auditView(kernel, query.traceId),
      };
    },
  );

  server.post<{ Body: SourceVersionRequest; Headers: SecurityHeaders }>(
    '/evidence/list',
    async (request) => {
      const query = createQuery({
        messageType: 'ListEvidenceSpans',
        schemaVersion: '1.0.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        ...requestContext(request.headers),
        payload: request.body,
      });
      const delivery = await kernel.connector.query(query);
      return {
        evidence: delivery.result.payload,
        trace: traceView(kernel, query.traceId),
        audit: auditView(kernel, query.traceId),
      };
    },
  );

  server.post<{ Body: EvidenceRequest; Headers: SecurityHeaders }>(
    '/evidence/resolve',
    async (request) => {
      const query = createQuery({
        messageType: 'GetEvidenceSpan',
        schemaVersion: '1.0.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        ...requestContext(request.headers),
        payload: request.body,
      });
      const delivery = await kernel.connector.query(query);
      return {
        evidence: delivery.result.payload,
        trace: traceView(kernel, query.traceId),
        audit: auditView(kernel, query.traceId),
      };
    },
  );

  server.post<{ Body: ResolveAssetRequest; Headers: SecurityHeaders }>(
    '/assets/resolve',
    async (request) => {
      const query = createQuery({
        messageType: 'ResolveAsset',
        schemaVersion: '1.0.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        ...requestContext(request.headers),
        payload: request.body,
      });
      const delivery = await kernel.connector.query(query);
      return {
        resolved: delivery.result.payload,
        trace: traceView(kernel, query.traceId),
        audit: auditView(kernel, query.traceId),
      };
    },
  );

  server.post<{ Body: KnowledgeStageRequest; Headers: SecurityHeaders }>(
    '/knowledge/groups/stage',
    async (request) => {
      const context = requestContext(request.headers);
      const delivery = await kernel.connector.sendCommand<KnowledgeReviewGroup>(
        createCommand({
          messageType: 'StageKnowledgeGroup',
          schemaVersion: '1.0.0',
          producerModule: 'shotgun-app',
          producerVersion: '1.0.0',
          idempotencyKey: `knowledge-stage:${context.projectId}:${request.body.groupId}`,
          ...context,
          payload: request.body,
        }),
      );
      return { group: delivery.result };
    },
  );

  server.post<{ Body: KnowledgeReviewRequest; Headers: SecurityHeaders }>(
    '/knowledge/groups/review',
    async (request) => {
      const context = requestContext(request.headers);
      const decisionId = request.body.decisionId ?? randomUUID();
      const delivery = await kernel.connector.sendCommand<KnowledgeReviewGroup>(
        createCommand({
          messageType: 'ReviewKnowledgeGroup',
          schemaVersion: '1.0.0',
          producerModule: 'shotgun-app',
          producerVersion: '1.0.0',
          idempotencyKey: `knowledge-review:${context.projectId}:${decisionId}`,
          ...context,
          payload: { ...request.body, decisionId },
        }),
      );
      return { group: delivery.result };
    },
  );

  server.post<{ Body: { readonly groupId: string }; Headers: SecurityHeaders }>(
    '/knowledge/groups/resolve',
    async (request) => {
      const delivery = await kernel.connector.query(
        createQuery({
          messageType: 'GetKnowledgeGroup',
          schemaVersion: '1.0.0',
          producerModule: 'shotgun-app',
          producerVersion: '1.0.0',
          ...requestContext(request.headers),
          payload: request.body,
        }),
      );
      return { review: delivery.result.payload };
    },
  );

  server.post<{ Body: KnowledgeImpactRequest; Headers: SecurityHeaders }>(
    '/knowledge/impact',
    async (request) => {
      const delivery = await kernel.connector.query<KnowledgeImpactResult>(
        createQuery({
          messageType: 'GetKnowledgeImpact',
          schemaVersion: '1.0.0',
          producerModule: 'shotgun-app',
          producerVersion: '1.0.0',
          ...requestContext(request.headers),
          payload: request.body,
        }),
      );
      return { impact: delivery.result.payload };
    },
  );

  server.post<{ Body: Record<string, never>; Headers: SecurityHeaders }>(
    '/knowledge/graph/query',
    async (request) => {
      const delivery = await kernel.connector.query<KnowledgeGraphView>(
        createQuery({
          messageType: 'GetKnowledgeGraph',
          schemaVersion: '1.0.0',
          producerModule: 'shotgun-app',
          producerVersion: '1.0.0',
          ...requestContext(request.headers),
          payload: request.body ?? {},
        }),
      );
      return { graph: delivery.result.payload };
    },
  );

  server.get('/knowledge', async (_request, reply) =>
    reply.type('text/html; charset=utf-8').send(knowledgePage()),
  );

  server.get('/vendor/cytoscape.min.js', async (_request, reply) =>
    reply
      .type('application/javascript; charset=utf-8')
      .send(await readFile(path.resolve('node_modules/cytoscape/dist/cytoscape.min.js'), 'utf8')),
  );

  server.post<{
    Body: { readonly mode: 'FULL_REBUILD' | 'INCREMENTAL' };
    Headers: SecurityHeaders;
  }>('/compiled-truth/build', async (request) => {
    const context = requestContext(request.headers);
    const delivery = await kernel.connector.sendCommand<CompiledTruthProjection>(
      createCommand({
        messageType: 'BuildCompiledTruth',
        schemaVersion: '1.0.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        idempotencyKey: `compiled-truth:${context.projectId}:${request.body.mode}:${randomUUID()}`,
        ...context,
        payload: request.body,
      }),
    );
    return { projection: delivery.result };
  });

  server.post<{ Body: Record<string, never>; Headers: SecurityHeaders }>(
    '/compiled-truth/query',
    async (request) => {
      const context = requestContext(request.headers);
      const projection = await kernel.connector.query<CompiledTruthProjection>(
        createQuery({
          messageType: 'GetCompiledTruth',
          schemaVersion: '1.0.0',
          producerModule: 'shotgun-app',
          producerVersion: '1.0.0',
          ...context,
          payload: request.body ?? {},
        }),
      );
      const status = await kernel.connector.query<CompiledTruthProjectionStatus>(
        createQuery({
          messageType: 'GetCompiledTruthStatus',
          schemaVersion: '1.0.0',
          producerModule: 'shotgun-app',
          producerVersion: '1.0.0',
          ...context,
          payload: {},
        }),
      );
      return { projection: projection.result.payload, status: status.result.payload };
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/knowledge/discovery/schedules',
    async (request) => {
      const context = requestContext(request.headers);
      if (
        !context.security.accessScope.includes('owner') &&
        !context.security.accessScope.includes('admin')
      ) {
        throw new ShotgunError({
          code: 'PROJECT_ACCESS_DENIED',
          safeMessage: 'Owner or Admin authorization is required to configure Discovery schedules.',
          module: 'product-api',
          operation: 'configure-discovery-schedule',
        });
      }
      const configuration = requireDiscoveryScheduleConfigurationRequest(request.body);
      try {
        const schedule = await discoveryScheduler.registerSchedule({
          // Project authority comes only from the authenticated context; the
          // request body has no projectId or revision field.
          projectId: context.projectId,
          ...configuration,
          now: new Date().toISOString(),
        });
        return { schedule };
      } catch (error) {
        if (error instanceof ShotgunError) throw error;
        throw new ShotgunError({
          code: 'INVALID_REQUEST',
          safeMessage:
            error instanceof Error ? error.message : 'Discovery schedule configuration is invalid.',
          module: 'product-api',
          operation: 'configure-discovery-schedule',
          cause: error,
        });
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/knowledge/discovery/run',
    async (request) => {
      const context = requestContext(request.headers);
      const payload = requireDurableManualDiscoveryRequest(request.body, request.headers);
      const delivery = await kernel.connector.sendCommand(
        createCommand({
          messageType: 'RunKnowledgeDiscoveryDurable',
          schemaVersion: '1.0.0',
          producerModule: 'shotgun-app',
          producerVersion: '1.0.0',
          // The connector's physical delivery deduplication is intentionally
          // not the authority here. The coordinator resolves commandId+requestId
          // against PostgreSQL so a new delivery returns ALREADY_EXISTS.
          idempotencyKey: `knowledge-discovery-manual-delivery:${randomUUID()}`,
          ...context,
          payload,
        }),
      );
      return { discovery: delivery.result };
    },
  );

  server.post<{ Body: Record<string, never>; Headers: SecurityHeaders }>(
    '/knowledge/discovery/list',
    async (request) => {
      const delivery = await kernel.connector.query<{
        items: readonly DerivedInferenceCandidate[];
      }>(
        createQuery({
          messageType: 'ListDerivedInferences',
          schemaVersion: '1.0.0',
          producerModule: 'shotgun-app',
          producerVersion: '1.0.0',
          ...requestContext(request.headers),
          payload: request.body ?? {},
        }),
      );
      return { inferences: delivery.result.payload.items };
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>('/actions/preview', async (request) => {
    const context = requestContext(request.headers);
    const payload = requireActionPreviewRequest(request.body);
    const delivery = await kernel.connector.sendCommand<ActionExecutionRecord>(
      createCommand({
        messageType: 'PrepareActionPreview',
        schemaVersion: '1.1.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        idempotencyKey: `action-preview:${context.projectId}:${payload.candidateId}:${payload.expectedRevision}:${payload.operationKey}`,
        ...context,
        payload,
      }),
    );
    return { action: delivery.result };
  });

  server.post<{
    Params: { readonly actionId: string };
    Body: { readonly expectedPreviewDigest: string };
    Headers: SecurityHeaders;
  }>('/actions/:actionId/approve', async (request) => {
    const context = requestContext(request.headers);
    const delivery = await kernel.connector.sendCommand<ActionExecutionRecord>(
      createCommand({
        messageType: 'ApproveActionPreview',
        schemaVersion: '1.1.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        idempotencyKey: `action-approve:${request.params.actionId}:${request.body.expectedPreviewDigest}:${context.actor.id}`,
        ...context,
        payload: { actionId: request.params.actionId, ...request.body },
      }),
    );
    return { action: delivery.result };
  });

  server.post<{
    Body: unknown;
    Headers: SecurityHeaders;
  }>('/actions/execute', async (request) => {
    const context = requestContext(request.headers);
    const payload = requireActionExecuteRequest(request.body);
    const delivery = await kernel.connector.sendCommand<ActionExecutionRecord>(
      createCommand({
        messageType: 'ExecuteApprovedAction',
        schemaVersion: '1.1.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        idempotencyKey: `action-execute:${payload.approvalId}`,
        ...context,
        payload,
      }),
    );
    return { action: delivery.result };
  });

  server.post<{
    Params: { readonly actionId: string };
    Body: Record<string, never>;
    Headers: SecurityHeaders;
  }>('/actions/:actionId/query', async (request) => {
    const delivery = await kernel.connector.query<ActionExecutionRecord>(
      createQuery({
        messageType: 'GetActionExecution',
        schemaVersion: '1.1.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        ...requestContext(request.headers),
        payload: { actionId: request.params.actionId },
      }),
    );
    return { action: delivery.result.payload };
  });

  server.post<{
    Params: { readonly actionId: string };
    Body: Record<string, never>;
    Headers: SecurityHeaders;
  }>('/actions/:actionId/audit', async (request) => {
    const delivery = await kernel.connector.query<{ items: readonly ActionAuditEvent[] }>(
      createQuery({
        messageType: 'ListActionAudit',
        schemaVersion: '1.1.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        ...requestContext(request.headers),
        payload: { actionId: request.params.actionId },
      }),
    );
    return { audit: delivery.result.payload.items };
  });

  server.post<{ Body: EntityVaultStageRequest; Headers: SecurityHeaders }>(
    '/knowledge/entity-vault/stage',
    async (request) => {
      const context = requestContext(request.headers);
      const delivery = await kernel.connector.sendCommand<EntityVaultImport>(
        createCommand({
          messageType: 'StageEntityVaultImport',
          schemaVersion: '1.0.0',
          producerModule: 'shotgun-app',
          producerVersion: '1.0.0',
          idempotencyKey: `entity-vault-stage:${context.projectId}:${request.body.importId}`,
          ...context,
          payload: request.body,
        }),
      );
      return { stagedImport: delivery.result };
    },
  );

  server.post<{ Body: EntityVaultReviewRequest; Headers: SecurityHeaders }>(
    '/knowledge/entity-vault/review',
    async (request) => {
      const context = requestContext(request.headers);
      const delivery = await kernel.connector.sendCommand<EntityVaultImport>(
        createCommand({
          messageType: 'ReviewEntityVaultImport',
          schemaVersion: '1.0.0',
          producerModule: 'shotgun-app',
          producerVersion: '1.0.0',
          idempotencyKey: `entity-vault-review:${context.projectId}:${request.body.importId}:${request.body.decision}`,
          ...context,
          payload: request.body,
        }),
      );
      return { stagedImport: delivery.result };
    },
  );

  server.post<{ Body: { readonly importId: string }; Headers: SecurityHeaders }>(
    '/knowledge/entity-vault/resolve',
    async (request) => {
      const delivery = await kernel.connector.query<EntityVaultImport>(
        createQuery({
          messageType: 'GetEntityVaultImport',
          schemaVersion: '1.0.0',
          producerModule: 'shotgun-app',
          producerVersion: '1.0.0',
          ...requestContext(request.headers),
          payload: request.body,
        }),
      );
      return { stagedImport: delivery.result.payload };
    },
  );

  server.addHook('onClose', async () => {
    await discoveryExecutionWorker?.stop();
    await discoveryReentryWorker?.stop();
    await discoverySchedulerWorker?.stop();
    await canonicalProjectionRecoveryWorker?.stop();
    await kernel.shutdown();
    await options.closeResources?.();
  });

  // LPA-WP4 (D03/D05): same-origin built-SPA serving. @fastify/static
  // (10.1.2, exact pin) serves real static assets; the not-found handler
  // provides a browser-route-only SPA fallback. Reserved API namespaces
  // (/api, /product-api, /health) are NEVER absorbed into index.html and keep
  // their existing 404 semantics; non-GET/HEAD unknown routes also keep 404.
  if (options.spaDirectory) {
    const spaRoot = path.resolve(options.spaDirectory);
    await server.register(staticPlugin, {
      root: spaRoot,
      prefix: '/',
      wildcard: false,
      decorateReply: false,
    });
    const notFoundJson = (request: { method: string; url: string }) => ({
      message: `Route ${request.method}:${request.url.split('?')[0] ?? request.url} not found`,
      error: 'Not Found',
      statusCode: 404,
    });
    server.setNotFoundHandler(async (request, reply) => {
      const urlPath = request.url.split('?')[0] ?? request.url;
      const isApiReserved =
        urlPath === '/health' ||
        urlPath === '/api' ||
        urlPath.startsWith('/api/') ||
        urlPath === '/product-api' ||
        urlPath.startsWith('/product-api/');
      if ((request.method !== 'GET' && request.method !== 'HEAD') || isApiReserved) {
        return reply.code(404).send(notFoundJson(request));
      }
      try {
        const html = await readFile(path.join(spaRoot, 'index.html'), 'utf8');
        return reply
          .type('text/html; charset=utf-8')
          .header('cache-control', 'no-cache')
          .send(html);
      } catch {
        return reply.code(404).send(notFoundJson(request));
      }
    });
  }

  return {
    server,
    kernel,
    repositories: {
      intake: intakeRepository,
      originalAsset: originalAssetRepository,
      transformation: transformationRepository,
      evidence: evidenceRepository,
      aiProvider: aiProviderRepository,
      candidates: candidateRepository,
      validation: validationRepository,
      comparisons: comparisonRepository,
      reviews: changeSetReviewRepository,
      canonical: canonicalKnowledgeRepository,
      projection: searchProjectionRepository,
      knowledge: knowledgeModelRepository,
      compiledTruth: compiledTruthRepository,
      actionCandidates: actionCandidateRepository,
      actions: actionExecutionRepository,
    },
    storage: assetStorage,
    state: {
      ping: ping.state,
      pong: pong.state,
      canonicalProjectionRecovery: {
        latest: () => latestCanonicalProjectionRecoveryReport,
      },
      canonicalProjectionRecoveryReporter,
    },
  };
};
