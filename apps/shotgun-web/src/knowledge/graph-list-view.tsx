import type { GraphEdgeV1, GraphNodeReferenceV1, GraphNodeV1 } from '@shotgun/api-client';

import {
  graphAccessibleTuples,
  graphNodeRefById,
  graphSelectedNodeId,
  type GraphAccessibleTuple,
} from './graph-accessible.js';

/**
 * List fallback view (AC-19/AC-21). Exposes the identical accessible
 * `(nodeId, edgeId, label, authority, baseViewMembership,
 * overlayMemberships)` tuple set as the canvas, table and path views, from
 * the same snapshot response.
 */

const authorityLabel = (authority: GraphAccessibleTuple['authority']): string => {
  if (authority === 'CANONICAL') return 'Canonical';
  if (authority === 'DERIVED_INFERENCE') return 'Derived inference';
  return 'Discovery candidate';
};

/**
 * AC-08: per-authority non-color visual cue class. The stylesheet gives each
 * authority a distinct computed signature (border-left-style, font-style,
 * font-weight, text-decoration) that is independent of color, so Canonical
 * and inferred items remain distinguishable without relying on hue.
 */
export const authorityVisualClass = (authority: GraphAccessibleTuple['authority']): string => {
  if (authority === 'CANONICAL') return 'graph-item--canonical';
  if (authority === 'DERIVED_INFERENCE') return 'graph-item--derived';
  return 'graph-item--discovery';
};

export const GraphListView = ({
  nodes,
  edges,
  selectedRef,
  onSelect,
  onCorrect,
  ariaLabel,
}: {
  readonly nodes: readonly GraphNodeV1[];
  readonly edges: readonly GraphEdgeV1[];
  readonly selectedRef: GraphNodeReferenceV1 | null;
  readonly onSelect: (ref: GraphNodeReferenceV1) => void;
  readonly onCorrect: (ref: GraphNodeReferenceV1) => void;
  readonly ariaLabel: string;
}) => {
  const tuples = graphAccessibleTuples(nodes, edges);
  const nodeRefs = graphNodeRefById(nodes);
  const selectedNodeId = graphSelectedNodeId(nodes, selectedRef);
  return (
    <section role="region" aria-label={ariaLabel} className="graph-list-view">
      <h2 className="visually-hidden">Graph list</h2>
      <ul className="graph-list">
        {tuples.map((tuple) => {
          const key = tuple.kind === 'node' ? tuple.nodeId : tuple.edgeId;
          const selected = tuple.kind === 'node' && tuple.nodeId === selectedNodeId;
          const nodeRef = tuple.kind === 'node' ? nodeRefs.get(tuple.nodeId) : undefined;
          return (
            <li
              key={key}
              className={`graph-item${selected ? ' graph-item--selected' : ''} ${authorityVisualClass(tuple.authority)}`}
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
              <span className="graph-item-authority">{authorityLabel(tuple.authority)}</span>
              <span className="graph-item-base-view">{tuple.baseViewMembership}</span>
              <span className="graph-item-overlays">{tuple.overlayMemberships.join(', ')}</span>
              {nodeRef ? (
                <span className="graph-item-actions">
                  <button type="button" onClick={() => onSelect(nodeRef)}>
                    Select
                  </button>
                  <button type="button" onClick={() => onCorrect(nodeRef)}>
                    보정
                  </button>
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
};
