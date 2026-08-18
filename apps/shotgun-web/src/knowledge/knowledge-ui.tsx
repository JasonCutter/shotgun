import type {
  KnowledgeAuthority,
  KnowledgeEvidenceReturnTarget,
  KnowledgeItemView,
  KnowledgeKind,
  KnowledgeLineageView,
  KnowledgePageSummaryView,
  KnowledgePageView,
  KnowledgeProjectionStatus,
  KnowledgeProjectionStatusView,
  KnowledgeTemporalState,
} from '@shotgun/api-client';
import { Link } from 'react-router';
import type { ReactNode } from 'react';
import { TechnicalDetails } from '../components/technical-details.js';

export const KNOWLEDGE_AUTHORITIES = [
  'CANONICAL',
  'APPROVED_KNOWLEDGE',
  'COMPILED_TRUTH',
  'DERIVED_INFERENCE',
] as const satisfies readonly KnowledgeAuthority[];

export const KNOWLEDGE_KINDS = [
  'CLAIM',
  'FACT',
  'ENTITY',
  'RELATION',
  'EVENT',
  'DECISION',
  'ACTION',
  'CONFLICT',
  'KNOWLEDGE_GAP',
  'DERIVED_INFERENCE',
] as const satisfies readonly KnowledgeKind[];

export const KNOWLEDGE_TEMPORAL_STATES = [
  'CURRENT',
  'PAST',
  'FUTURE',
  'CONFLICT',
] as const satisfies readonly KnowledgeTemporalState[];

export const KNOWLEDGE_PROJECTION_STATUSES = [
  'READY',
  'STALE',
  'DEGRADED',
  'NOT_BUILT',
] as const satisfies readonly KnowledgeProjectionStatus[];

export type KnowledgeEvidenceReturnEnvelope = {
  readonly originRoute: string;
  readonly target: KnowledgeEvidenceReturnTarget;
};

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const decodeEvidenceTarget = (value: unknown): KnowledgeEvidenceReturnTarget | undefined => {
  if (!isRecord(value)) return undefined;
  const fields = [
    'resourceId',
    'resourceRevision',
    'focusId',
    'sourceId',
    'sourceVersionId',
    'evidenceId',
  ] as const;
  if (fields.some((field) => !isText(value[field]))) return undefined;
  return {
    resourceId: value.resourceId as string,
    resourceRevision: value.resourceRevision as string,
    focusId: value.focusId as string,
    sourceId: value.sourceId as string,
    sourceVersionId: value.sourceVersionId as string,
    evidenceId: value.evidenceId as string,
  };
};

export const decodeKnowledgeEvidenceReturnEnvelope = (
  value: unknown,
): KnowledgeEvidenceReturnEnvelope | undefined => {
  if (
    !isRecord(value) ||
    !isText(value.originRoute) ||
    !value.originRoute.startsWith('/knowledge/')
  ) {
    return undefined;
  }
  const target = decodeEvidenceTarget(value.target);
  return target ? { originRoute: value.originRoute, target } : undefined;
};

export const decodeKnowledgeEvidenceReturnState = (
  value: unknown,
  expectedSourceId: string,
  expectedSourceVersionId: string,
): KnowledgeEvidenceReturnEnvelope | undefined => {
  if (!isRecord(value)) return undefined;
  const envelope = decodeKnowledgeEvidenceReturnEnvelope(value.knowledgeReturnTarget);
  return envelope &&
    envelope.target.sourceId === expectedSourceId &&
    envelope.target.sourceVersionId === expectedSourceVersionId
    ? envelope
    : undefined;
};

export const decodeKnowledgeResourceReturnState = (
  value: unknown,
  expectedResourceId: string,
  expectedRevision: string,
): KnowledgeEvidenceReturnEnvelope | undefined => {
  if (!isRecord(value)) return undefined;
  const envelope = decodeKnowledgeEvidenceReturnEnvelope(value.knowledgeReturnTarget);
  return envelope &&
    envelope.target.resourceId === expectedResourceId &&
    envelope.target.resourceRevision === expectedRevision
    ? envelope
    : undefined;
};

export const knowledgeEvidenceReturnState = (envelope: KnowledgeEvidenceReturnEnvelope) => ({
  knowledgeReturnTarget: envelope,
});

export const authorityDescription = (authority: KnowledgeAuthority): string => {
  switch (authority) {
    case 'CANONICAL':
      return 'Canonical source of truth';
    case 'APPROVED_KNOWLEDGE':
      return 'Approved knowledge projection';
    case 'COMPILED_TRUTH':
      return 'Compiled derived projection';
    case 'DERIVED_INFERENCE':
      return 'Derived inference, not Canonical';
  }
};

export const authorityLabel = (authority: KnowledgeAuthority): string => {
  switch (authority) {
    case 'CANONICAL':
      return 'Canonical knowledge';
    case 'APPROVED_KNOWLEDGE':
      return 'Approved knowledge';
    case 'COMPILED_TRUTH':
      return 'Derived view';
    case 'DERIVED_INFERENCE':
      return 'Derived inference';
  }
};

export const knowledgeKindLabel = (kind: KnowledgeKind): string => {
  const labels: Readonly<Record<KnowledgeKind, string>> = {
    CLAIM: 'Claim',
    FACT: 'Fact',
    ENTITY: 'Entity',
    RELATION: 'Relationship',
    EVENT: 'Event',
    DECISION: 'Decision',
    ACTION: 'Action',
    CONFLICT: 'Conflict',
    KNOWLEDGE_GAP: 'Knowledge gap',
    DERIVED_INFERENCE: 'Derived inference',
  };
  return labels[kind];
};

export const temporalStateLabel = (state: KnowledgeTemporalState): string => {
  const labels: Readonly<Record<KnowledgeTemporalState, string>> = {
    CURRENT: 'Current',
    PAST: 'Past',
    FUTURE: 'Future',
    CONFLICT: 'Conflicting',
  };
  return labels[state];
};

export const projectionDescription = (status: KnowledgeProjectionStatus): string => {
  switch (status) {
    case 'READY':
      return 'Ready';
    case 'STALE':
      return 'Stale; not current';
    case 'DEGRADED':
      return 'Degraded; incomplete';
    case 'NOT_BUILT':
      return 'Not built';
  }
};

export const projectionKindLabel = (kind: string): string => {
  const labels: Readonly<Record<string, string>> = {
    CANONICAL_SEARCH: 'Verified knowledge search',
    COMPILED_TRUTH: 'Derived knowledge view',
    APPROVED_KNOWLEDGE: 'Approved knowledge view',
  };
  return labels[kind] ?? 'Knowledge view';
};

export const searchMatchTypeLabel = (matchType: string): string => {
  const labels: Readonly<Record<string, string>> = {
    FULL_TEXT: 'Text match',
    TRIGRAM: 'Similar text',
    SUBSTRING: 'Phrase match',
  };
  return labels[matchType] ?? 'Knowledge match';
};

export const ProjectionStatus = ({
  projection,
  heading = 'Projection status',
}: {
  readonly projection: KnowledgeProjectionStatusView;
  readonly heading?: string;
}) => {
  const isReady = projection.status === 'READY';
  const technicalDetails = (
    <TechnicalDetails
      items={[
        { label: 'Projection kind', value: projection.projectionKind },
        { label: 'Canonical version', value: projection.canonicalVersion },
        { label: 'Projected version', value: projection.projectedCanonicalVersion },
        { label: 'Projection lag', value: projection.lag },
        ...(projection.updatedAt
          ? [{ label: 'Projection updated', value: projection.updatedAt }]
          : []),
      ]}
    />
  );
  if (isReady) return technicalDetails;
  return (
    <>
      {technicalDetails}
      <section
        className={`knowledge-projection knowledge-projection--${projection.status.toLowerCase()}`}
        aria-labelledby={`${heading.toLowerCase().replaceAll(' ', '-')}-heading`}
      >
        <h3 id={`${heading.toLowerCase().replaceAll(' ', '-')}-heading`}>{heading}</h3>
        <p>
          <strong>{projectionDescription(projection.status)}</strong>
        </p>
        <p className="stale-state" role="status">
          This projection is not presented as current. {projection.reason ?? 'No reason supplied.'}
        </p>
      </section>
    </>
  );
};

export const AuthorityLabel = ({ authority }: { readonly authority: KnowledgeAuthority }) => (
  <span className="knowledge-authority" data-authority={authority}>
    <strong>{authorityLabel(authority)}</strong>
    <span>{authorityDescription(authority)}</span>
  </span>
);

const displayValue = (value: string | number | undefined): string =>
  value === undefined ? 'Not supplied' : String(value);

export const LineageMetadata = ({
  lineage,
  heading = 'Lineage and provenance',
}: {
  readonly lineage: KnowledgeLineageView;
  readonly heading?: string;
}) => {
  const fields: readonly [string, string | number | undefined][] = [
    ['Project', lineage.projectId],
    ['Product', lineage.productId],
    ['Resource revision', lineage.resourceRevision],
    ['Projection ID', lineage.projectionId],
    ['Canonical resource', lineage.canonicalResourceId],
    ['Canonical revision', lineage.canonicalRevisionId],
    ['Canonical version', lineage.canonicalVersion],
    ['Source', lineage.sourceId],
    ['SourceVersion', lineage.sourceVersionId],
    ['Knowledge group', lineage.knowledgeGroupId],
    ['Candidate', lineage.candidateId],
    ['Projection digest', lineage.projectionLogicalDigest],
    ['Compiled item', lineage.compiledItemId],
    ['Source snapshot', lineage.sourceSnapshotDigest],
    ['Inference', lineage.inferenceId],
    ['Source projection digest', lineage.sourceProjectionDigest],
    ['Commit', lineage.commitId],
    ['Manifest', lineage.manifestId],
    ['ChangeSet', lineage.changeSetId],
  ];
  return (
    <TechnicalDetails
      summary={heading}
      inspectionItems={[
        ...fields.map(([label, value]) => ({ label, value: displayValue(value) })),
        ...(lineage.evidenceIds && lineage.evidenceIds.length > 0
          ? [{ label: 'Evidence IDs', value: lineage.evidenceIds.join(', ') }]
          : []),
        ...(lineage.projection
          ? [
              { label: 'Lineage projection kind', value: lineage.projection.projectionKind },
              { label: 'Lineage projection status', value: lineage.projection.status },
              { label: 'Lineage canonical version', value: lineage.projection.canonicalVersion },
              {
                label: 'Lineage projected version',
                value: lineage.projection.projectedCanonicalVersion,
              },
              { label: 'Lineage projection lag', value: lineage.projection.lag },
            ]
          : []),
      ]}
    />
  );
};

export const EvidenceLinks = ({
  item,
  originRoute,
}: {
  readonly item: KnowledgeItemView;
  readonly originRoute: string;
}) =>
  item.evidenceTargets && item.evidenceTargets.length > 0 ? (
    <section className="knowledge-evidence-links" aria-labelledby={`evidence-${item.resourceId}`}>
      <h4 id={`evidence-${item.resourceId}`}>Pinned Evidence</h4>
      <ul>
        {item.evidenceTargets.map((target) => {
          const envelope: KnowledgeEvidenceReturnEnvelope = { originRoute, target };
          return (
            <li key={`${target.sourceId}:${target.sourceVersionId}:${target.evidenceId}`}>
              <Link
                to={`/sources/${encodeURIComponent(target.sourceId)}?version=${encodeURIComponent(target.sourceVersionId)}`}
                state={knowledgeEvidenceReturnState(envelope)}
              >
                Open source evidence
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  ) : null;

export const KnowledgeItemCard = ({
  item,
  originRoute,
}: {
  readonly item: KnowledgeItemView;
  readonly originRoute: string;
}) => (
  <article className="knowledge-item" data-knowledge-focus={item.lineage.productId} tabIndex={-1}>
    <header>
      <h3>{item.label}</h3>
      <div className="knowledge-tag-row" aria-label="Knowledge classification">
        <AuthorityLabel authority={item.authority} />
        <span className="knowledge-tag">Kind: {knowledgeKindLabel(item.kind)}</span>
        <span className="knowledge-tag">Time: {temporalStateLabel(item.temporalState)}</span>
      </div>
    </header>
    {item.summary ? <p>{item.summary}</p> : null}
    {item.content ? <pre className="knowledge-content">{item.content}</pre> : null}
    <LineageMetadata lineage={item.lineage} />
    <EvidenceLinks item={item} originRoute={originRoute} />
  </article>
);

export const PageSummaryCard = ({
  page,
  selected,
  onToggle,
}: {
  readonly page: KnowledgePageSummaryView;
  readonly selected: boolean;
  readonly onToggle: () => void;
}) => (
  <li className="knowledge-page-card">
    <div>
      <h3>
        <Link
          to={`/knowledge/${encodeURIComponent(page.resourceId)}?revision=${encodeURIComponent(page.revision)}`}
        >
          {page.title}
        </Link>
      </h3>
      <TechnicalDetails
        items={[
          { label: 'Resource ID', value: page.resourceId },
          { label: 'Revision', value: page.revision },
        ]}
      />
      <div className="knowledge-tag-row">
        <AuthorityLabel authority={page.primaryAuthority} />
        <span className="knowledge-tag">Kind: {knowledgeKindLabel(page.primaryKind)}</span>
      </div>
      <ProjectionStatus projection={page.projection} heading={`${page.title} projection`} />
    </div>
    <label className="knowledge-compare-select">
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        aria-label={`Select ${page.title} for compare`}
      />
      Select for compare
    </label>
  </li>
);

export const PagePreview = ({
  page,
  heading,
  children,
}: {
  readonly page: KnowledgePageView;
  readonly heading: string;
  readonly children?: ReactNode;
}) => (
  <section className="knowledge-page-preview action-card" aria-labelledby={`${heading}-heading`}>
    <h2 id={`${heading}-heading`}>{heading}</h2>
    <h3>{page.title}</h3>
    <TechnicalDetails
      items={[
        { label: 'Resource ID', value: page.resourceId },
        { label: 'Revision', value: page.revision },
      ]}
    />
    <ProjectionStatus projection={page.projection} heading={`${heading} projection`} />
    <p>Read and exploration tools are available for this page.</p>
    {children}
  </section>
);
