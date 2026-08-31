import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router';

import {
  GRAPH_CORRECTION_QUERY_KEY,
  decodeGraphCorrectionSeed,
} from '../knowledge/graph-correction.js';

import {
  createFrontendKnowledgeDraftClient,
  type GlobalShellView,
  type KnowledgeAuthority,
  type KnowledgeKind,
  type KnowledgeProjectionStatus,
  type KnowledgeSearchRequest,
  type KnowledgeTemporalState,
} from '@shotgun/api-client';

import { useAppRuntime } from '../app/providers.js';
import { EmptyState } from '../components/empty-state.js';
import { ErrorState } from '../components/error-state.js';
import { LoadingState } from '../components/loading-state.js';
import { TechnicalDetails } from '../components/technical-details.js';
import { useProductLocalization } from '../localization/product-localization.js';
import {
  knowledgePageListQueryOptions,
  knowledgeCanManuallyRetry,
  knowledgeSearchQueryOptions,
  knowledgeWorkspaceQueryOptions,
} from '../knowledge/knowledge-queries.js';
import {
  KNOWLEDGE_AUTHORITIES,
  KNOWLEDGE_KINDS,
  KNOWLEDGE_PROJECTION_STATUSES,
  KNOWLEDGE_TEMPORAL_STATES,
  PageSummaryCard,
  ProjectionStatus,
  authorityLabel,
  knowledgeKindLabel,
  projectionDescription,
  searchMatchTypeLabel,
  temporalStateLabel,
} from '../knowledge/knowledge-ui.js';
import { KnowledgeDraftEditor } from '../knowledge/knowledge-draft-editor.js';

const pageSize = 50;

const readEnum = <T extends string>(value: string | null, values: readonly T[]): T | undefined =>
  value && values.includes(value as T) ? (value as T) : undefined;

const setOptionalParameter = (parameters: URLSearchParams, key: string, value: string) => {
  if (value) parameters.set(key, value);
  else parameters.delete(key);
};

export const KnowledgeWorkspace = () => {
  const { apiClient } = useAppRuntime();
  const { shell } = useOutletContext<{ readonly shell: GlobalShellView }>();
  const { t } = useProductLocalization();
  const [searchParameters, setSearchParameters] = useSearchParams();
  const parameterString = searchParameters.toString();
  const urlQuery = searchParameters.get('q') ?? '';
  const urlAuthority = readEnum(searchParameters.get('authority'), KNOWLEDGE_AUTHORITIES);
  const urlKind = readEnum(searchParameters.get('kind'), KNOWLEDGE_KINDS);
  const urlTemporalState = readEnum(
    searchParameters.get('temporalState'),
    KNOWLEDGE_TEMPORAL_STATES,
  );
  const urlProjectionStatus = readEnum(
    searchParameters.get('projectionStatus'),
    KNOWLEDGE_PROJECTION_STATUSES,
  );
  const [searchInput, setSearchInput] = useState(urlQuery);
  const [authority, setAuthority] = useState<KnowledgeAuthority | ''>(urlAuthority ?? '');
  const [kind, setKind] = useState<KnowledgeKind | ''>(urlKind ?? '');
  const [temporalState, setTemporalState] = useState<KnowledgeTemporalState | ''>(
    urlTemporalState ?? '',
  );
  const [projectionStatus, setProjectionStatus] = useState<KnowledgeProjectionStatus | ''>(
    urlProjectionStatus ?? '',
  );
  const [selectedPageIds, setSelectedPageIds] = useState<readonly string[]>([]);
  const knowledgeDraftClient = useMemo(() => createFrontendKnowledgeDraftClient(), []);

  useEffect(() => {
    setSearchInput(urlQuery);
    setAuthority(urlAuthority ?? '');
    setKind(urlKind ?? '');
    setTemporalState(urlTemporalState ?? '');
    setProjectionStatus(urlProjectionStatus ?? '');
  }, [parameterString]);

  const searchRequest = useMemo<KnowledgeSearchRequest>(() => {
    const filters = {
      ...(urlAuthority ? { authorities: [urlAuthority] } : {}),
      ...(urlKind ? { kinds: [urlKind] } : {}),
      ...(urlTemporalState ? { temporalStates: [urlTemporalState] } : {}),
      ...(urlProjectionStatus ? { projectionStatuses: [urlProjectionStatus] } : {}),
    };
    return {
      schemaVersion: '1.0.0',
      query: urlQuery.trim(),
      ...(Object.keys(filters).length > 0 ? { filters } : {}),
      pageSize,
    };
  }, [urlAuthority, urlKind, urlProjectionStatus, urlTemporalState, urlQuery]);

  const workspace = useQuery(
    knowledgeWorkspaceQueryOptions(apiClient, shell, {
      schemaVersion: '1.0.0',
      pageSize,
    }),
  );
  const pages = useQuery(
    knowledgePageListQueryOptions(apiClient, shell, {
      schemaVersion: '1.0.0',
      pageSize,
    }),
  );
  const search = useQuery({
    ...knowledgeSearchQueryOptions(apiClient, shell, searchRequest),
    enabled: Boolean(shell.activeProject && searchRequest.query),
  });

  // AC-25: a graph correction seed carried in the URL is decoded strictly and
  // surfaced as the editor's correction target. A malformed seed is ignored;
  // the seed is a read proposal and never writes Canonical data.
  const correctionSeed = useMemo(
    () => decodeGraphCorrectionSeed(searchParameters.get(GRAPH_CORRECTION_QUERY_KEY)),
    [parameterString, searchParameters],
  );

  if (!shell.activeProject) {
    return (
      <section className="route-page knowledge-workspace">
        <p className="eyebrow">Knowledge Workspace</p>
        <h1 tabIndex={-1}>Knowledge</h1>
        <EmptyState
          title="Create a Project before opening Knowledge"
          description="Create a Project before opening Knowledge."
        />
      </section>
    );
  }

  const onSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = new URLSearchParams(searchParameters);
    const submittedQuery = searchInput.trim();
    setOptionalParameter(next, 'q', submittedQuery);
    setOptionalParameter(next, 'authority', authority);
    setOptionalParameter(next, 'kind', kind);
    setOptionalParameter(next, 'temporalState', temporalState);
    setOptionalParameter(next, 'projectionStatus', projectionStatus);
    setSearchParameters(next);
  };

  const togglePage = (pageId: string) => {
    setSelectedPageIds((current) => {
      if (current.includes(pageId)) return current.filter((item) => item !== pageId);
      return current.length < 2 ? [...current, pageId] : current;
    });
  };

  const projection = pages.data?.projection ?? workspace.data?.projection;
  const searchReadiness =
    search.data && 'readiness' in search.data ? search.data.readiness : undefined;

  return (
    <section className="route-page knowledge-workspace">
      <p className="eyebrow">Read-only Knowledge Workspace</p>
      <h1 tabIndex={-1}>Knowledge</h1>

      <section className="action-card" aria-labelledby="knowledge-search-heading">
        <div className="knowledge-section-heading">
          <div>
            <h2 id="knowledge-search-heading">Search and filter</h2>
          </div>
          <div className="knowledge-heading-actions">
            <Link to="/knowledge/compare">Open typed compare</Link>
            <Link to="/knowledge/discoveries">{t('discovery.open_inbox')}</Link>
          </div>
        </div>
        <form className="knowledge-search-form" role="search" onSubmit={onSearch}>
          <label htmlFor="knowledge-search-query">Search Knowledge</label>
          <input
            id="knowledge-search-query"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            maxLength={500}
          />
          <label htmlFor="knowledge-authority-filter">Authority</label>
          <select
            id="knowledge-authority-filter"
            value={authority}
            onChange={(event) => setAuthority(event.target.value as KnowledgeAuthority | '')}
          >
            <option value="">All authorities</option>
            {KNOWLEDGE_AUTHORITIES.map((value) => (
              <option key={value} value={value}>
                {authorityLabel(value)}
              </option>
            ))}
          </select>
          <label htmlFor="knowledge-kind-filter">Kind</label>
          <select
            id="knowledge-kind-filter"
            value={kind}
            onChange={(event) => setKind(event.target.value as KnowledgeKind | '')}
          >
            <option value="">All kinds</option>
            {KNOWLEDGE_KINDS.map((value) => (
              <option key={value} value={value}>
                {knowledgeKindLabel(value)}
              </option>
            ))}
          </select>
          <label htmlFor="knowledge-temporal-filter">Temporal state</label>
          <select
            id="knowledge-temporal-filter"
            value={temporalState}
            onChange={(event) =>
              setTemporalState(event.target.value as KnowledgeTemporalState | '')
            }
          >
            <option value="">All temporal states</option>
            {KNOWLEDGE_TEMPORAL_STATES.map((value) => (
              <option key={value} value={value}>
                {temporalStateLabel(value)}
              </option>
            ))}
          </select>
          <label htmlFor="knowledge-projection-filter">Projection status</label>
          <select
            id="knowledge-projection-filter"
            value={projectionStatus}
            onChange={(event) =>
              setProjectionStatus(event.target.value as KnowledgeProjectionStatus | '')
            }
          >
            <option value="">All projection statuses</option>
            {KNOWLEDGE_PROJECTION_STATUSES.map((value) => (
              <option key={value} value={value}>
                {projectionDescription(value)}
              </option>
            ))}
          </select>
          <button type="submit">Search Knowledge</button>
        </form>
        {urlQuery ? (
          <p className="status-message" role="status" aria-live="polite">
            Showing results for <strong>{urlQuery}</strong>
          </p>
        ) : null}
      </section>

      {projection ? <ProjectionStatus projection={projection} /> : null}
      {correctionSeed ? (
        <section className="action-card" aria-labelledby="graph-correction-heading">
          <h2 id="graph-correction-heading">그래프 보정 대상</h2>
          <p className="status-message" role="status" aria-live="polite">
            {correctionSeed.targetKind === 'EDGE' ? '관계' : '지식 항목'}을 보정할 준비가 되었습니다
            {correctionSeed.masked ? ' (제한된 항목)' : ''}.
          </p>
          <TechnicalDetails
            items={[
              {
                label: 'Resource',
                value: `${correctionSeed.stableResourceRef.resourceKind}:${correctionSeed.stableResourceRef.resourceId}`,
              },
              { label: 'Snapshot ID', value: correctionSeed.snapshotId },
              { label: 'Projection revision', value: correctionSeed.projectionRevision },
              { label: 'Change intent', value: correctionSeed.suggestedChangeIntent },
            ]}
          />
        </section>
      ) : null}
      <KnowledgeDraftEditor
        draft={null}
        activeProjectId={shell.activeProject?.id}
        sessionId={shell.sessionId}
        client={knowledgeDraftClient}
      />
      {workspace.data ? (
        <section className="action-card" aria-labelledby="knowledge-capabilities-heading">
          <h2 id="knowledge-capabilities-heading">Available actions</h2>
          <p>Browse, search, compare, and inspect the knowledge available to this project.</p>
        </section>
      ) : null}

      {workspace.error ? (
        <ErrorState
          error={workspace.error}
          onRetry={
            knowledgeCanManuallyRetry(workspace.error) ? () => void workspace.refetch() : undefined
          }
        />
      ) : null}
      {pages.error ? (
        <ErrorState
          error={pages.error}
          onRetry={knowledgeCanManuallyRetry(pages.error) ? () => void pages.refetch() : undefined}
        />
      ) : null}
      {workspace.isPending || pages.isPending ? (
        <LoadingState message="Loading Knowledge Workspace" />
      ) : null}

      {pages.data && pages.data.pages.length === 0 ? (
        <EmptyState
          title="No Knowledge Pages"
          description="The server returned no readable Knowledge Pages for this Project."
        />
      ) : null}
      {pages.data && pages.data.pages.length > 0 ? (
        <section className="action-card" aria-labelledby="knowledge-pages-heading">
          <div className="knowledge-section-heading">
            <div>
              <h2 id="knowledge-pages-heading">Knowledge Pages</h2>
              <p>Select two server-provided Pages for a read-only comparison.</p>
            </div>
            {selectedPageIds.length === 2 ? (
              <Link
                className="primary-link"
                to={`/knowledge/compare?left=${encodeURIComponent(selectedPageIds[0]!)}&right=${encodeURIComponent(selectedPageIds[1]!)}`}
              >
                Compare selected Pages
              </Link>
            ) : (
              <span className="status-message">Select {2 - selectedPageIds.length} more</span>
            )}
          </div>
          <ul className="knowledge-page-list" aria-label="Knowledge Pages">
            {pages.data.pages.map((page) => (
              <PageSummaryCard
                key={page.pageId}
                page={page}
                selected={selectedPageIds.includes(page.pageId)}
                onToggle={() => togglePage(page.pageId)}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {urlQuery ? (
        <section className="action-card" aria-labelledby="knowledge-results-heading">
          <h2 id="knowledge-results-heading">Search results</h2>
          {search.isPending ? <LoadingState message="Searching server Knowledge" /> : null}
          {search.error ? (
            <ErrorState
              error={search.error}
              onRetry={
                knowledgeCanManuallyRetry(search.error) ? () => void search.refetch() : undefined
              }
            />
          ) : null}
          {searchReadiness?.partial ? (
            <p className="stale-state" role="status">
              Search results may be incomplete. Refresh before relying on them.
            </p>
          ) : null}
          {search.data ? (
            <ProjectionStatus projection={search.data.projection} heading="Search projection" />
          ) : null}
          {searchReadiness ? (
            <TechnicalDetails
              summary="Search readiness details"
              inspectionItems={[
                {
                  label: 'Canonical search status',
                  value: searchReadiness.canonicalSearch.status,
                },
                {
                  label: 'Source projection statuses',
                  value: JSON.stringify(searchReadiness.sourceProjections),
                },
              ]}
            />
          ) : null}
          {search.data && search.data.matches.length === 0 ? (
            <EmptyState
              title="No matching Knowledge"
              description="The server returned no matches."
            />
          ) : null}
          {search.data && search.data.matches.length > 0 ? (
            <ol className="knowledge-search-results" aria-label="Server Knowledge search results">
              {search.data.matches.map((match) => (
                <li key={match.matchId}>
                  <div>
                    <h3>{match.item.label}</h3>
                    <p>
                      <Link
                        to={`/knowledge/${encodeURIComponent(match.resourceId)}?revision=${encodeURIComponent(match.item.revision)}&focus=${encodeURIComponent(match.item.lineage.productId)}`}
                      >
                        Open stable detail
                      </Link>
                    </p>
                    {match.snippet ? <p>{match.snippet}</p> : null}
                    <p>
                      <AuthorityLabelText authority={match.item.authority} /> ·{' '}
                      {knowledgeKindLabel(match.item.kind)} ·{' '}
                      {temporalStateLabel(match.item.temporalState)}
                    </p>
                  </div>
                  <p>{searchMatchTypeLabel(match.matchType)}</p>
                  <TechnicalDetails
                    items={[
                      { label: 'Score', value: match.score },
                      { label: 'Match type', value: match.matchType },
                      { label: 'Authority source', value: match.matchAuthority },
                      { label: 'Revision', value: match.item.revision },
                      {
                        label: 'Canonical version',
                        value: search.data.projection.canonicalVersion,
                      },
                    ]}
                  />
                </li>
              ))}
            </ol>
          ) : null}
        </section>
      ) : null}
    </section>
  );
};

const AuthorityLabelText = ({ authority }: { readonly authority: KnowledgeAuthority }) => (
  <span>
    <strong>{authority}</strong>
  </span>
);
