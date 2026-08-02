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

export const ProjectionStatus = ({
  projection,
  heading = 'Projection status',
}: {
  readonly projection: KnowledgeProjectionStatusView;
  readonly heading?: string;
}) => {
  const isReady = projection.status === 'READY';
  return (
    <section
      className={`knowledge-projection knowledge-projection--${projection.status.toLowerCase()}`}
      aria-labelledby={`${heading.toLowerCase().replaceAll(' ', '-')}-heading`}
    >
      <h3 id={`${heading.toLowerCase().replaceAll(' ', '-')}-heading`}>{heading}</h3>
      <p>
        <strong>{projection.status}</strong> — {projectionDescription(projection.status)}
      </p>
      <dl className="knowledge-inline-metadata">
        <div>
          <dt>Projection</dt>
          <dd>{projection.projectionKind}</dd>
        </div>
        <div>
          <dt>Canonical version</dt>
          <dd>{projection.canonicalVersion}</dd>
        </div>
        <div>
          <dt>Projected version</dt>
          <dd>{projection.projectedCanonicalVersion}</dd>
        </div>
        <div>
          <dt>Lag</dt>
          <dd>{projection.lag}</dd>
        </div>
      </dl>
      {!isReady ? (
        <p className="stale-state" role="status">
          This projection is not presented as current. {projection.reason ?? 'No reason supplied.'}
        </p>
      ) : null}
      {projection.updatedAt ? <small>Updated {projection.updatedAt}</small> : null}
    </section>
  );
};

export const AuthorityLabel = ({ authority }: { readonly authority: KnowledgeAuthority }) => (
  <span className="knowledge-authority" data-authority={authority}>
    <strong>{authority}</strong>
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
    <section className="knowledge-lineage" aria-labelledby={`${heading}-heading`}>
      <h3 id={`${heading}-heading`}>{heading}</h3>
      <dl className="knowledge-metadata-grid">
        {fields.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{displayValue(value)}</dd>
          </div>
        ))}
      </dl>
      {lineage.evidenceIds && lineage.evidenceIds.length > 0 ? (
        <p>
          Evidence IDs: <code>{lineage.evidenceIds.join(', ')}</code>
        </p>
      ) : null}
      {lineage.projection ? (
        <ProjectionStatus projection={lineage.projection} heading="Lineage projection" />
      ) : null}
    </section>
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
                Open pinned SourceVersion and Evidence {target.evidenceId}
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
        <span className="knowledge-tag">Kind: {item.kind}</span>
        <span className="knowledge-tag">Temporal: {item.temporalState}</span>
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
      <p>
        <code>{page.resourceId}</code> · revision <code>{page.revision}</code>
      </p>
      <div className="knowledge-tag-row">
        <AuthorityLabel authority={page.primaryAuthority} />
        <span className="knowledge-tag">Kind: {page.primaryKind}</span>
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
    <p>
      Resource <code>{page.resourceId}</code> · revision <code>{page.revision}</code>
    </p>
    <ProjectionStatus projection={page.projection} heading={`${heading} projection`} />
    <div className="knowledge-tag-row" aria-label={`${heading} capabilities`}>
      {page.capabilities.map((capability) => (
        <span className="knowledge-tag" key={capability}>
          {capability}
        </span>
      ))}
    </div>
    {children}
  </section>
);
