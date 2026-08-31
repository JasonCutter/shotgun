import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useOutletContext, useParams, useSearchParams } from 'react-router';

import {
  createFrontendDiscoveryClient,
  DISCOVERY_FINDING_LIFECYCLE_STATES,
  DISCOVERY_FINDING_TYPES,
  ShotgunApiError,
  type DiscoveryFindingLifecycleState,
  type DiscoveryFindingPayloadV1,
  type DiscoveryFindingType,
  type DiscoveryProductFindingDetailV1,
  type DiscoveryProductFindingSummaryV1,
  type DiscoveryResourceRefV1,
  type GlobalShellView,
} from '@shotgun/api-client';

import { useAppRuntime } from '../app/providers.js';
import { useOptionalDiscoveryCommandContext } from '../commands/discovery-command-context.js';
import { EmptyState } from '../components/empty-state.js';
import { ErrorState } from '../components/error-state.js';
import { LoadingState } from '../components/loading-state.js';
import { safeErrorMessage } from '../components/error-state.js';
import { useProductLocalization } from '../localization/product-localization.js';
import {
  discoveryCanManuallyRetry,
  discoveryDetailQueryOptions,
  discoveryInboxQueryOptions,
} from '../knowledge/discovery-queries.js';

type Translator = ReturnType<typeof useProductLocalization>['t'];

const pageSize = 25;

const readEnum = <T extends string>(value: string | null, values: readonly T[]): T | undefined =>
  value && values.includes(value as T) ? (value as T) : undefined;

const setOptionalParameter = (parameters: URLSearchParams, key: string, value: string) => {
  if (value) parameters.set(key, value);
  else parameters.delete(key);
};

const findingTypeLabel = (t: Translator, value: DiscoveryFindingType): string => {
  switch (value) {
    case 'KNOWLEDGE_GAP':
      return t('discovery.type.knowledge_gap');
    case 'EVIDENCE_GAP':
      return t('discovery.type.evidence_gap');
    case 'RELATION_HYPOTHESIS':
      return t('discovery.type.relation_hypothesis');
    case 'PATTERN_HYPOTHESIS':
      return t('discovery.type.pattern_hypothesis');
    case 'CONFLICT_HYPOTHESIS':
      return t('discovery.type.conflict_hypothesis');
    case 'CLARIFICATION_QUESTION':
      return t('discovery.type.clarification_question');
    case 'ACTION_SUGGESTION':
      return t('discovery.type.action_suggestion');
  }
};

const lifecycleLabel = (t: Translator, value: DiscoveryFindingLifecycleState): string => {
  switch (value) {
    case 'NEW':
      return t('discovery.lifecycle.new');
    case 'VALIDATING':
      return t('discovery.lifecycle.validating');
    case 'REVIEW_READY':
      return t('discovery.lifecycle.review_ready');
    case 'REENTERED':
      return t('discovery.lifecycle.reentered');
    case 'DISMISSED':
      return t('discovery.lifecycle.dismissed');
    case 'SUPPRESSED':
      return t('discovery.lifecycle.suppressed');
    case 'RESOLVED':
      return t('discovery.lifecycle.resolved');
    case 'STALE':
      return t('discovery.lifecycle.stale');
    case 'SUPERSEDED':
      return t('discovery.lifecycle.superseded');
  }
};

const generationLabel = (
  t: Translator,
  value: DiscoveryProductFindingSummaryV1['generationMethod'],
) => {
  switch (value) {
    case 'DETERMINISTIC':
      return t('discovery.generation.deterministic');
    case 'AI_ASSISTED':
      return t('discovery.generation.ai_assisted');
    case 'HYBRID':
      return t('discovery.generation.hybrid');
  }
};

const reentryLabel = (
  t: Translator,
  value: DiscoveryProductFindingDetailV1['governance']['reentryState'],
) => {
  switch (value) {
    case 'NOT_REQUESTED':
      return t('discovery.reentry.not_requested');
    case 'PROCESSED':
      return t('discovery.reentry.processed');
    case 'INELIGIBLE':
      return t('discovery.reentry.ineligible');
    case 'BLOCKED_NON_RETRYABLE':
      return t('discovery.reentry.blocked_non_retryable');
    case 'RETRYABLE':
      return t('discovery.reentry.retryable');
  }
};

const validationLabel = (
  t: Translator,
  value: DiscoveryProductFindingDetailV1['governance']['validationState'],
) => {
  switch (value) {
    case 'NOT_STARTED':
      return t('discovery.validation.not_started');
    case 'VALIDATING':
      return t('discovery.validation.validating');
    case 'VALIDATED':
      return t('discovery.validation.validated');
    case 'UNKNOWN':
      return t('discovery.validation.unknown');
  }
};

const reviewReadinessLabel = (
  t: Translator,
  value: DiscoveryProductFindingDetailV1['governance']['reviewReadiness'],
) =>
  value === 'ELIGIBLE_AFTER_VALIDATION'
    ? t('discovery.review_readiness.eligible')
    : t('discovery.review_readiness.not_eligible');

const freshnessLabel = (
  t: Translator,
  value: DiscoveryProductFindingDetailV1['freshness']['state'],
) => {
  switch (value) {
    case 'CURRENT':
      return t('discovery.freshness.current');
    case 'REVALIDATION_REQUIRED':
      return t('discovery.freshness.revalidation_required');
    case 'UNKNOWN':
      return t('discovery.freshness.unknown');
  }
};

const freshnessDescription = (
  t: Translator,
  value: DiscoveryProductFindingDetailV1['freshness']['state'],
) => {
  switch (value) {
    case 'CURRENT':
      return t('discovery.freshness_current');
    case 'REVALIDATION_REQUIRED':
      return t('discovery.freshness_revalidation');
    case 'UNKNOWN':
      return t('discovery.freshness_unknown');
  }
};

const resourceLabel = (t: Translator, value: DiscoveryResourceRefV1['resourceKind']): string => {
  switch (value) {
    case 'CANONICAL_CLAIM':
      return t('discovery.resource.canonical_claim');
    case 'CANONICAL_ENTITY':
      return t('discovery.resource.canonical_entity');
    case 'CANONICAL_EVENT':
      return t('discovery.resource.canonical_event');
    case 'CANONICAL_RELATION':
      return t('discovery.resource.canonical_relation');
    case 'CANONICAL_CONFLICT':
      return t('discovery.resource.canonical_conflict');
    case 'CANONICAL_DECISION':
      return t('discovery.resource.canonical_decision');
    case 'SOURCE':
      return t('discovery.resource.source');
    case 'SOURCE_VERSION':
      return t('discovery.resource.source_version');
    case 'COMPILED_TRUTH_ITEM':
      return t('discovery.resource.compiled_truth_item');
  }
};

const parsePositiveRevision = (value: string | null): number | undefined => {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision > 0 ? revision : undefined;
};

const canOpenReview = (finding: DiscoveryProductFindingDetailV1): boolean =>
  finding.lifecycleState === 'REVIEW_READY' &&
  finding.capabilities.canOpenReview &&
  finding.governance.reviewReadiness === 'ELIGIBLE_AFTER_VALIDATION' &&
  Boolean(finding.governance.reviewResourceId?.trim());

const DiscoveryTag = ({
  children,
  tone,
}: {
  readonly children: string;
  readonly tone?: string;
}) => (
  <span className="discovery-tag" data-tone={tone}>
    {children}
  </span>
);

const ResourceReference = ({
  resource,
  t,
}: {
  readonly resource: DiscoveryResourceRefV1;
  readonly t: Translator;
}) => {
  const label = resourceLabel(t, resource.resourceKind);
  const revision = resource.resourceRevision?.trim();
  const encodedId = encodeURIComponent(resource.resourceId);
  const encodedRevision = revision ? encodeURIComponent(revision) : null;
  const href =
    resource.resourceKind === 'SOURCE' && encodedRevision
      ? `/sources/${encodedId}?version=${encodedRevision}`
      : resource.resourceKind !== 'SOURCE' &&
          resource.resourceKind !== 'SOURCE_VERSION' &&
          encodedRevision
        ? `/knowledge/${encodedId}?revision=${encodedRevision}`
        : null;

  return (
    <li className="discovery-resource-item">
      {href ? (
        <Link to={href} aria-label={`${t('discovery.open_related_resource')}: ${label}`}>
          {label}
        </Link>
      ) : (
        <span>{label}</span>
      )}
    </li>
  );
};

const ResourceReferenceList = ({
  resources,
  t,
}: {
  readonly resources: readonly DiscoveryResourceRefV1[];
  readonly t: Translator;
}) =>
  resources.length > 0 ? (
    <ul className="discovery-resource-list">
      {resources.map((resource, index) => (
        <ResourceReference
          key={`${resource.resourceKind}-${resource.resourceId}-${index}`}
          resource={resource}
          t={t}
        />
      ))}
    </ul>
  ) : null;

const PayloadDetails = ({
  payload,
  t,
}: {
  readonly payload: DiscoveryFindingPayloadV1;
  readonly t: Translator;
}) => {
  switch (payload.payloadType) {
    case 'KNOWLEDGE_GAP':
      return (
        <dl className="discovery-detail-grid">
          {'subject' in payload ? (
            <>
              <dt>{t('discovery.subject')}</dt>
              <dd>{payload.subject}</dd>
            </>
          ) : null}
          {'missingFact' in payload ? (
            <>
              <dt>{t('discovery.missing_information')}</dt>
              <dd>{payload.missingFact}</dd>
            </>
          ) : null}
          {'missingTimeDescription' in payload ? (
            <>
              <dt>{t('discovery.missing_information')}</dt>
              <dd>{payload.missingTimeDescription}</dd>
            </>
          ) : null}
          {'term' in payload ? (
            <>
              <dt>{t('discovery.subject')}</dt>
              <dd>{payload.term}</dd>
              <dt>{t('discovery.context')}</dt>
              <dd>{payload.context}</dd>
            </>
          ) : null}
          {'knownConflictRef' in payload ? (
            <>
              <dt>{t('discovery.resource')}</dt>
              <dd>
                <ResourceReferenceList resources={[payload.knownConflictRef]} t={t} />
              </dd>
              <dt>{t('discovery.missing_information')}</dt>
              <dd>{payload.missingResolutionInput}</dd>
            </>
          ) : null}
          <dt>{t('discovery.question')}</dt>
          <dd>{payload.question}</dd>
        </dl>
      );
    case 'EVIDENCE_GAP':
      return (
        <dl className="discovery-detail-grid">
          <dt>{t('discovery.resource')}</dt>
          <dd>
            <ResourceReferenceList resources={[payload.affectedResourceRef]} t={t} />
          </dd>
          <dt>{t('discovery.coverage_gap')}</dt>
          <dd>{payload.coverageGap}</dd>
          <dt>{t('discovery.required_evidence')}</dt>
          <dd>{payload.requiredEvidence}</dd>
        </dl>
      );
    case 'RELATION_HYPOTHESIS':
      return (
        <>
          <dl className="discovery-detail-grid">
            <dt>{t('discovery.source_endpoint')}</dt>
            <dd>
              <ResourceReferenceList resources={[payload.sourceEndpoint]} t={t} />
            </dd>
            <dt>{t('discovery.target_endpoint')}</dt>
            <dd>
              <ResourceReferenceList resources={[payload.targetEndpoint]} t={t} />
            </dd>
            <dt>{t('discovery.proposed_relation')}</dt>
            <dd>{payload.proposedRelationType}</dd>
            <dt>{t('discovery.direction')}</dt>
            <dd>
              {payload.direction === 'DIRECTED'
                ? t('discovery.direction.directed')
                : t('discovery.direction.undirected')}
            </dd>
          </dl>
          {payload.temporalQualification ? (
            <p className="discovery-supporting-copy">{payload.temporalQualification.description}</p>
          ) : null}
        </>
      );
    case 'PATTERN_HYPOTHESIS':
      return (
        <>
          <dl className="discovery-detail-grid">
            <dt>{t('discovery.pattern')}</dt>
            <dd>{payload.patternStatement}</dd>
            <dt>{t('discovery.context')}</dt>
            <dd>{payload.patternIdentity}</dd>
          </dl>
          <h3>{t('discovery.members')}</h3>
          <ResourceReferenceList resources={payload.memberResourceRefs} t={t} />
        </>
      );
    case 'CONFLICT_HYPOTHESIS':
      return (
        <>
          <dl className="discovery-detail-grid">
            <dt>{t('discovery.contradiction')}</dt>
            <dd>{payload.possibleContradiction}</dd>
          </dl>
          <h3>{t('discovery.members')}</h3>
          <ResourceReferenceList resources={payload.participatingResourceRefs} t={t} />
        </>
      );
    case 'CLARIFICATION_QUESTION':
      return (
        <>
          <dl className="discovery-detail-grid">
            <dt>{t('discovery.question')}</dt>
            <dd>{payload.question}</dd>
            <dt>{t('discovery.context')}</dt>
            <dd>{payload.context}</dd>
            <dt>{t('discovery.investigation_next_step')}</dt>
            <dd>{payload.proposedNextStep}</dd>
          </dl>
          <h3>{t('discovery.resource')}</h3>
          <ResourceReferenceList resources={payload.investigationTargetRefs} t={t} />
        </>
      );
    case 'ACTION_SUGGESTION':
      return (
        <>
          <dl className="discovery-detail-grid">
            <dt>{t('discovery.suggested_action')}</dt>
            <dd>{payload.suggestedAction}</dd>
            <dt>{t('discovery.rationale')}</dt>
            <dd>{payload.rationale}</dd>
            <dt>{t('discovery.execution_status')}</dt>
            <dd>{t('discovery.candidate_only')}</dd>
            {payload.riskContext ? (
              <>
                <dt>{t('discovery.risk_context')}</dt>
                <dd>{payload.riskContext}</dd>
              </>
            ) : null}
          </dl>
          <ResourceReferenceList resources={payload.affectedResourceRefs} t={t} />
        </>
      );
  }
};

const EvidenceLinks = ({
  finding,
  t,
}: {
  readonly finding: DiscoveryProductFindingDetailV1;
  readonly t: Translator;
}) => {
  if (!finding.capabilities.canInspectEvidence || finding.lineage.evidence.length === 0)
    return null;
  return (
    <ul className="discovery-resource-list">
      {finding.lineage.evidence.map((evidence, index) => (
        <li
          className="discovery-resource-item"
          key={`${evidence.evidenceId}-${evidence.evidenceRevisionId}`}
        >
          <Link
            to={`/sources/${encodeURIComponent(evidence.sourceId)}?version=${encodeURIComponent(evidence.sourceVersionId)}&view=evidence`}
            aria-label={`${t('discovery.open_source_evidence')} ${index + 1}`}
          >
            {t('discovery.open_source_evidence')} {index + 1}
          </Link>
        </li>
      ))}
    </ul>
  );
};

const FindingTags = ({
  finding,
  t,
}: {
  readonly finding: DiscoveryProductFindingSummaryV1;
  readonly t: Translator;
}) => {
  const reviewReady =
    finding.lifecycleState === 'REVIEW_READY' &&
    finding.capabilities.canOpenReview &&
    finding.governance.reviewReadiness === 'ELIGIBLE_AFTER_VALIDATION' &&
    Boolean(finding.governance.reviewResourceId?.trim());
  return (
    <div className="discovery-tag-row">
      <DiscoveryTag tone="type">{findingTypeLabel(t, finding.findingType)}</DiscoveryTag>
      <DiscoveryTag tone="lifecycle">{lifecycleLabel(t, finding.lifecycleState)}</DiscoveryTag>
      <DiscoveryTag tone="authority">{t('discovery.non_canonical')}</DiscoveryTag>
      {reviewReady ? (
        <DiscoveryTag tone="review">{t('discovery.review_ready')}</DiscoveryTag>
      ) : null}
    </div>
  );
};

export const DiscoveryInboxWorkspace = () => {
  const { shell } = useOutletContext<{ readonly shell: GlobalShellView }>();
  const { t } = useProductLocalization();
  const [searchParameters, setSearchParameters] = useSearchParams();
  const parameterString = searchParameters.toString();
  const urlFindingType = readEnum(searchParameters.get('findingType'), DISCOVERY_FINDING_TYPES);
  const urlLifecycleState = readEnum(
    searchParameters.get('lifecycleState'),
    DISCOVERY_FINDING_LIFECYCLE_STATES,
  );
  const [findingType, setFindingType] = useState<DiscoveryFindingType | ''>(urlFindingType ?? '');
  const [lifecycleState, setLifecycleState] = useState<DiscoveryFindingLifecycleState | ''>(
    urlLifecycleState ?? '',
  );
  const client = useMemo(() => createFrontendDiscoveryClient(), []);
  const request = useMemo(
    () => ({
      limit: pageSize,
      ...(urlFindingType ? { findingTypes: [urlFindingType] } : {}),
      ...(urlLifecycleState ? { lifecycleStates: [urlLifecycleState] } : {}),
    }),
    [urlFindingType, urlLifecycleState],
  );
  const list = useInfiniteQuery(discoveryInboxQueryOptions(client, shell, request));
  const findings = useMemo(() => {
    const seen = new Set<string>();
    return (list.data?.pages.flatMap((page) => page.findings) ?? []).filter((finding) => {
      const identity = `${finding.findingId}:${finding.findingRevision}`;
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
  }, [list.data]);

  useEffect(() => {
    setFindingType(urlFindingType ?? '');
    setLifecycleState(urlLifecycleState ?? '');
  }, [parameterString, urlFindingType, urlLifecycleState]);

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = new URLSearchParams(searchParameters);
    setOptionalParameter(next, 'findingType', findingType);
    setOptionalParameter(next, 'lifecycleState', lifecycleState);
    setSearchParameters(next);
  };

  if (!shell.activeProject) {
    return (
      <section className="route-page discovery-workspace">
        <p className="eyebrow">{t('discovery.eyebrow')}</p>
        <h1 tabIndex={-1}>{t('discovery.title')}</h1>
        <EmptyState
          title={t('discovery.empty_title')}
          description={t('discovery.empty_description')}
        />
      </section>
    );
  }

  return (
    <section className="route-page discovery-workspace">
      <p className="eyebrow">{t('discovery.eyebrow')}</p>
      <div className="discovery-page-heading">
        <div>
          <h1 tabIndex={-1}>{t('discovery.title')}</h1>
          <p className="discovery-supporting-copy">{t('discovery.intro')}</p>
        </div>
        <Link to="/knowledge">{t('discovery.back_to_knowledge')}</Link>
      </div>

      <section className="action-card" aria-labelledby="discovery-filter-heading">
        <div className="knowledge-section-heading">
          <h2 id="discovery-filter-heading">{t('discovery.filter_heading')}</h2>
        </div>
        <form className="discovery-filter-form" onSubmit={applyFilters}>
          <label htmlFor="discovery-type-filter">{t('discovery.type_filter')}</label>
          <select
            id="discovery-type-filter"
            value={findingType}
            onChange={(event) => setFindingType(event.target.value as DiscoveryFindingType | '')}
          >
            <option value="">{t('discovery.all_types')}</option>
            {DISCOVERY_FINDING_TYPES.map((value) => (
              <option key={value} value={value}>
                {findingTypeLabel(t, value)}
              </option>
            ))}
          </select>
          <label htmlFor="discovery-lifecycle-filter">{t('discovery.lifecycle_filter')}</label>
          <select
            id="discovery-lifecycle-filter"
            value={lifecycleState}
            onChange={(event) =>
              setLifecycleState(event.target.value as DiscoveryFindingLifecycleState | '')
            }
          >
            <option value="">{t('discovery.all_lifecycles')}</option>
            {DISCOVERY_FINDING_LIFECYCLE_STATES.map((value) => (
              <option key={value} value={value}>
                {lifecycleLabel(t, value)}
              </option>
            ))}
          </select>
          <button type="submit">{t('discovery.apply_filters')}</button>
        </form>
      </section>

      {list.isPending ? <LoadingState message={t('discovery.loading')} /> : null}
      {list.isError ? (
        <section aria-label={t('discovery.list_failure')}>
          <ErrorState
            error={list.error}
            onRetry={discoveryCanManuallyRetry(list.error) ? () => void list.refetch() : undefined}
          />
        </section>
      ) : null}
      {list.data && findings.length === 0 && !list.hasNextPage ? (
        <EmptyState
          title={t('discovery.empty_title')}
          description={t('discovery.empty_description')}
        />
      ) : null}
      {findings.length > 0 || list.hasNextPage ? (
        <section className="discovery-list" aria-labelledby="discovery-list-heading">
          <h2 id="discovery-list-heading">{t('discovery.title')}</h2>
          <ul>
            {findings.map((finding) => (
              <li
                className="discovery-card"
                key={`${finding.findingId}:${finding.findingRevision}`}
              >
                <div className="discovery-card-heading">
                  <div>
                    <h3>
                      <Link
                        to={`/knowledge/discoveries/${encodeURIComponent(finding.findingId)}?revision=${finding.findingRevision}`}
                      >
                        {finding.title}
                      </Link>
                    </h3>
                    <FindingTags finding={finding} t={t} />
                  </div>
                </div>
                <p>{finding.summary}</p>
                <p className="discovery-authority">{t('discovery.non_canonical')}</p>
              </li>
            ))}
          </ul>
          {list.hasNextPage ? (
            <div className="discovery-load-more">
              <button
                type="button"
                onClick={() => void list.fetchNextPage()}
                disabled={list.isFetchingNextPage}
              >
                {list.isFetchingNextPage ? t('discovery.loading_more') : t('discovery.load_more')}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </section>
  );
};

export const DiscoveryDetailWorkspace = () => {
  const { queryClient } = useAppRuntime();
  const { shell } = useOutletContext<{ readonly shell: GlobalShellView }>();
  const { t } = useProductLocalization();
  const discoveryCommands = useOptionalDiscoveryCommandContext();
  const { findingId = '' } = useParams();
  const [searchParameters] = useSearchParams();
  const findingRevision = parsePositiveRevision(searchParameters.get('revision'));
  const client = useMemo(() => createFrontendDiscoveryClient(), []);
  const detail = useQuery(
    discoveryDetailQueryOptions(client, shell, findingId, findingRevision ?? 0),
  );
  const finding = detail.data?.finding;
  const exactIdentityMatches =
    finding?.findingId === findingId && finding?.findingRevision === findingRevision;
  const [dismissError, setDismissError] = useState<unknown>();
  const [focusAfterDismiss, setFocusAfterDismiss] = useState(false);
  const dismissHeadingRef = useRef<HTMLHeadingElement>(null);
  const currentDiscoveryContextRef = useRef<{
    readonly projectId?: string;
    readonly findingId: string;
    readonly findingRevision?: number;
  }>({
    projectId: shell.activeProject?.id,
    findingId,
    findingRevision,
  });
  currentDiscoveryContextRef.current = {
    projectId: shell.activeProject?.id,
    findingId,
    findingRevision,
  };
  const dismissMutation = useMutation({
    mutationFn: (request: Parameters<typeof client.dismissDiscoveryFinding>[0]) =>
      client.dismissDiscoveryFinding(request),
  });
  const dismissPending =
    dismissMutation.isPending &&
    dismissMutation.variables?.findingId === finding?.findingId &&
    dismissMutation.variables?.findingRevision === finding?.findingRevision;
  const invalidateDiscovery = useCallback(async () => {
    const activeProject = shell.activeProject;
    if (!activeProject) return;
    await queryClient.invalidateQueries({
      queryKey: [
        'project',
        shell.principalId,
        shell.sessionId,
        activeProject.id,
        activeProject.id,
        shell.accessRevision,
        shell.policyContextRevision,
        activeProject.sensitivityClearance,
        'knowledge',
        'discoveries',
      ],
    });
  }, [queryClient, shell]);
  const dismiss = useCallback(
    (invoker: HTMLElement | null) => {
      void invoker;
      if (
        !finding ||
        !exactIdentityMatches ||
        !shell.activeProject ||
        !finding.capabilities.canDismiss
      ) {
        return;
      }
      const request = {
        schemaVersion: '1.0.0' as const,
        clientRequestId: globalThis.crypto.randomUUID(),
        idempotencyKey: globalThis.crypto.randomUUID(),
        findingId: finding.findingId,
        findingRevision: finding.findingRevision,
      };
      const requestProjectId = shell.activeProject.id;
      const isCurrentContext = () => {
        const current = currentDiscoveryContextRef.current;
        return (
          current.projectId === requestProjectId &&
          current.findingId === request.findingId &&
          current.findingRevision === request.findingRevision
        );
      };
      setDismissError(undefined);
      void dismissMutation
        .mutateAsync(request)
        .then(async () => {
          if (!isCurrentContext()) return;
          await invalidateDiscovery();
          if (!isCurrentContext()) return;
          setFocusAfterDismiss(true);
        })
        .catch(async (error: unknown) => {
          if (!isCurrentContext()) return;
          if (
            error instanceof ShotgunApiError &&
            error.code === 'OUTCOME_INDETERMINATE' &&
            error.clientRequestId === request.clientRequestId
          ) {
            try {
              const outcome = await client.resolveDiscoveryDismissCommand(request.clientRequestId);
              if (outcome.outcomeState === 'COMPLETED') {
                if (!isCurrentContext()) return;
                await invalidateDiscovery();
                if (!isCurrentContext()) return;
                return;
              }
            } catch {
              // Keep the original uncertainty visible; do not retry the mutation.
            }
          }
          if (!isCurrentContext()) return;
          setDismissError(error);
        });
    },
    [
      client,
      dismissMutation,
      exactIdentityMatches,
      finding,
      invalidateDiscovery,
      shell.activeProject,
    ],
  );
  useEffect(() => {
    setDismissError(undefined);
    setFocusAfterDismiss(false);
  }, [findingId, findingRevision, shell.activeProject?.id]);
  useEffect(() => {
    if (
      !focusAfterDismiss ||
      !finding ||
      finding.lifecycleState !== 'DISMISSED' ||
      finding.capabilities.canDismiss
    ) {
      return;
    }
    dismissHeadingRef.current?.focus();
    setFocusAfterDismiss(false);
  }, [finding, focusAfterDismiss]);
  useEffect(() => {
    if (!discoveryCommands || !shell.activeProject || !finding || !exactIdentityMatches) return;
    return discoveryCommands.register({
      context: {
        projectId: shell.activeProject.id,
        findingId: finding.findingId,
        findingRevision: finding.findingRevision,
        canDismiss: finding.capabilities.canDismiss,
      },
      commandPending: dismissPending,
      dismiss,
    });
  }, [
    dismiss,
    dismissPending,
    discoveryCommands,
    exactIdentityMatches,
    finding,
    shell.activeProject,
  ]);

  if (!shell.activeProject) {
    return (
      <section className="route-page discovery-workspace">
        <p className="eyebrow">{t('discovery.eyebrow')}</p>
        <h1 tabIndex={-1}>{t('discovery.not_found_title')}</h1>
        <EmptyState description={t('discovery.not_found_description')} />
      </section>
    );
  }
  if (!findingId.trim() || !findingRevision) {
    return (
      <section className="route-page discovery-workspace">
        <p className="eyebrow">{t('discovery.eyebrow')}</p>
        <h1 tabIndex={-1}>{t('discovery.not_found_title')}</h1>
        <EmptyState description={t('discovery.not_found_description')} />
      </section>
    );
  }
  if (detail.isPending) return <LoadingState message={t('discovery.detail_loading')} />;
  if (detail.isError) {
    return (
      <section
        className="route-page discovery-workspace"
        aria-label={t('discovery.detail_failure')}
      >
        <ErrorState
          error={detail.error}
          onRetry={
            discoveryCanManuallyRetry(detail.error) ? () => void detail.refetch() : undefined
          }
        />
      </section>
    );
  }
  if (!finding || !exactIdentityMatches) {
    return (
      <section className="route-page discovery-workspace">
        <p className="eyebrow">{t('discovery.eyebrow')}</p>
        <h1 tabIndex={-1}>{t('discovery.not_found_title')}</h1>
        <EmptyState description={t('discovery.not_found_description')} />
      </section>
    );
  }

  const reviewAvailable = canOpenReview(finding);
  const reviewHref = reviewAvailable
    ? `/review?reviewResourceId=${encodeURIComponent(finding.governance.reviewResourceId!.trim())}`
    : null;
  const graphHref = finding.capabilities.canOpenGraph
    ? `/knowledge/graph?discoveryFinding=${encodeURIComponent(finding.findingId)}&discoveryRevision=${finding.findingRevision}`
    : null;
  const activityHref = finding.capabilities.canOpenActivity ? finding.activity?.resourceHref : null;

  return (
    <section className="route-page discovery-workspace">
      <p className="eyebrow">{t('discovery.eyebrow')}</p>
      <div className="discovery-page-heading">
        <div>
          <h1 ref={dismissHeadingRef} tabIndex={-1}>
            {finding.title}
          </h1>
          <FindingTags finding={finding} t={t} />
        </div>
        <Link to="/knowledge/discoveries">{t('discovery.back_to_knowledge')}</Link>
      </div>

      <section className="discovery-detail-lead" aria-labelledby="discovery-summary-heading">
        <h2 id="discovery-summary-heading">{t('discovery.summary')}</h2>
        <p>{finding.summary}</p>
      </section>

      <section className="discovery-section" aria-labelledby="discovery-rationale-heading">
        <h2 id="discovery-rationale-heading">{t('discovery.rationale')}</h2>
        <p>{finding.rationale}</p>
        <h3>{t('discovery.derivation')}</h3>
        <p>{finding.derivationSummary}</p>
      </section>

      <section className="discovery-section" aria-labelledby="discovery-governance-heading">
        <h2 id="discovery-governance-heading">{t('discovery.governance')}</h2>
        <dl className="discovery-detail-grid">
          <dt>{t('discovery.authority')}</dt>
          <dd>{t('discovery.non_canonical')}</dd>
          <dt>{t('discovery.finding_type')}</dt>
          <dd>{findingTypeLabel(t, finding.findingType)}</dd>
          <dt>{t('discovery.lifecycle')}</dt>
          <dd>{lifecycleLabel(t, finding.lifecycleState)}</dd>
          <dt>{t('discovery.generation')}</dt>
          <dd>{generationLabel(t, finding.generationMethod)}</dd>
          <dt>{t('discovery.reentry')}</dt>
          <dd>{reentryLabel(t, finding.governance.reentryState)}</dd>
          <dt>{t('discovery.validation')}</dt>
          <dd>{validationLabel(t, finding.governance.validationState)}</dd>
          <dt>{t('discovery.review_readiness')}</dt>
          <dd>{reviewReadinessLabel(t, finding.governance.reviewReadiness)}</dd>
        </dl>
        <div className="discovery-freshness">
          <h3>{t('discovery.freshness')}</h3>
          <p>
            <strong>{freshnessLabel(t, finding.freshness.state)}</strong>
          </p>
          <p>{freshnessDescription(t, finding.freshness.state)}</p>
        </div>
        {reviewHref || graphHref || activityHref || finding.capabilities.canDismiss ? (
          <p className="discovery-action-row">
            {reviewHref ? (
              <Link className="primary-link" to={reviewHref}>
                {t('discovery.open_review')}
              </Link>
            ) : null}
            {graphHref ? (
              <Link className="secondary-link" to={graphHref}>
                {t('discovery.open_graph')}
              </Link>
            ) : null}
            {activityHref ? (
              <Link className="secondary-link" to={activityHref}>
                Activity에서 실행 보기
              </Link>
            ) : null}
            {finding.capabilities.canDismiss ? (
              <button
                className="secondary-link"
                type="button"
                onClick={(event) => dismiss(event.currentTarget)}
                disabled={dismissPending}
                aria-describedby="discovery-dismiss-authority"
              >
                {dismissPending
                  ? t('commands.unavailable.discovery_pending')
                  : t('discovery.dismiss')}
              </button>
            ) : null}
          </p>
        ) : (
          <p className="status-message">{t('discovery.no_review_action')}</p>
        )}
        <p id="discovery-dismiss-authority" className="discovery-authority">
          {t('discovery.non_canonical')}
        </p>
        {dismissPending ? <p role="status">{t('commands.unavailable.discovery_pending')}</p> : null}
        {dismissMutation.isSuccess && finding.lifecycleState === 'DISMISSED' ? (
          <p role="status">{t('discovery.dismissed')}</p>
        ) : null}
        {dismissError ? (
          <p role="alert">
            {dismissError instanceof ShotgunApiError &&
            (dismissError.code === 'OUTCOME_INDETERMINATE' ||
              dismissError.code === 'OUTCOME_UNKNOWN')
              ? t('discovery.dismiss_outcome_unknown')
              : `${t('discovery.dismiss_failed')} ${safeErrorMessage(dismissError)}`}
          </p>
        ) : null}
      </section>

      <section className="discovery-section" aria-labelledby="discovery-payload-heading">
        <h2 id="discovery-payload-heading">{t('discovery.payload')}</h2>
        <PayloadDetails payload={finding.payload} t={t} />
      </section>

      <section className="discovery-section" aria-labelledby="discovery-related-heading">
        <h2 id="discovery-related-heading">{t('discovery.related_resources')}</h2>
        {finding.lineage.relatedResourceRefs.length > 0 ? (
          <ResourceReferenceList resources={finding.lineage.relatedResourceRefs} t={t} />
        ) : (
          <p>{t('discovery.no_lineage')}</p>
        )}
      </section>

      <section className="discovery-section" aria-labelledby="discovery-evidence-heading">
        <h2 id="discovery-evidence-heading">{t('discovery.evidence')}</h2>
        <EvidenceLinks finding={finding} t={t} />
        {!finding.capabilities.canInspectEvidence || finding.lineage.evidence.length === 0 ? (
          <p>{t('discovery.no_lineage')}</p>
        ) : null}
      </section>
    </section>
  );
};
