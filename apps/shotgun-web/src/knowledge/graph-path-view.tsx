import type {
  GraphEdgeV1,
  GraphNodeReferenceV1,
  GraphNodeV1,
  GraphPathDescriptionV1,
  GraphPathResultV1,
} from '@shotgun/api-client';

import {
  graphAccessibleTuples,
  graphNodeRefById,
  graphSelectedNodeId,
} from './graph-accessible.js';

/**
 * Path view (AC-19/AC-21). Narration of the found paths plus the identical
 * accessible `(nodeId, edgeId, label, authority, baseViewMembership,
 * overlayMemberships)` tuple set from the same snapshot response, so the path
 * view is not a reduced-information summary.
 */

export const GraphPathView = ({
  nodes,
  edges,
  path,
  description,
  selectedRef,
  onSelect,
  ariaLabel,
}: {
  readonly nodes: readonly GraphNodeV1[];
  readonly edges: readonly GraphEdgeV1[];
  readonly path: GraphPathResultV1 | null;
  readonly description: GraphPathDescriptionV1 | null;
  readonly selectedRef: GraphNodeReferenceV1 | null;
  readonly onSelect: (ref: GraphNodeReferenceV1) => void;
  readonly ariaLabel: string;
}) => {
  const tuples = graphAccessibleTuples(nodes, edges);
  const nodeRefs = graphNodeRefById(nodes);
  const selectedNodeId = graphSelectedNodeId(nodes, selectedRef);
  return (
    <section role="region" aria-label={ariaLabel} className="graph-path-view" tabIndex={0}>
      <h2 className="visually-hidden">Graph path</h2>
      {description ? (
        <div className="graph-path-narration">
          <p className="graph-path-summary">{description.summary}</p>
          <ol className="graph-path-steps">
            {description.segments.map((segment) => (
              <li key={segment.step}>
                {segment.kind === 'ORIGIN' ? (
                  <span>시작: {segment.narration}</span>
                ) : (
                  <span>
                    {segment.step}. {segment.narration}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
      ) : path && path.paths.length > 0 ? (
        <ul className="graph-path-list">
          {path.paths.map((found) => (
            <li key={found.pathId}>
              <span>{found.pathId}</span> — {found.segments.length} segments
            </li>
          ))}
        </ul>
      ) : (
        <p className="graph-path-empty">No path found between the selected resources.</p>
      )}
      <h3 className="graph-path-items-heading">Graph items</h3>
      <ul className="graph-list">
        {tuples.map((tuple) => {
          const key = tuple.kind === 'node' ? tuple.nodeId : tuple.edgeId;
          const selected = tuple.kind === 'node' && tuple.nodeId === selectedNodeId;
          const nodeRef = tuple.kind === 'node' ? nodeRefs.get(tuple.nodeId) : undefined;
          return (
            <li
              key={key}
              className={selected ? 'graph-item graph-item--selected' : 'graph-item'}
              data-graph-kind={tuple.kind}
              data-graph-id={key}
              data-graph-label={tuple.label}
              data-graph-authority={tuple.authority}
              data-graph-base-view={tuple.baseViewMembership}
              data-graph-overlays={tuple.overlayMemberships.join(',')}
            >
              <span className="graph-item-kind">{tuple.kind}</span>
              <span className="graph-item-id">{key}</span>
              <span className="graph-item-label">{tuple.label}</span>
              <span className="graph-item-authority">{tuple.authority}</span>
              <span className="graph-item-base-view">{tuple.baseViewMembership}</span>
              <span className="graph-item-overlays">{tuple.overlayMemberships.join(', ')}</span>
              {nodeRef ? (
                <button type="button" onClick={() => onSelect(nodeRef)}>
                  Select
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
};
