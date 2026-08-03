import type { GraphEdgeV1, GraphNodeReferenceV1, GraphNodeV1 } from '@shotgun/api-client';

import {
  graphAccessibleTuples,
  graphNodeRefById,
  graphSelectedNodeId,
} from './graph-accessible.js';

/**
 * Table fallback view (AC-19/AC-21). Exposes the identical accessible
 * `(nodeId, edgeId, label, authority, baseViewMembership,
 * overlayMemberships)` tuple set as the other views, from the same snapshot
 * response. All primary content is within a single column so 200% zoom keeps
 * it fully operable (AC-22).
 */

export const GraphTableView = ({
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
    <section role="region" aria-label={ariaLabel} className="graph-table-view">
      <h2 className="visually-hidden">Graph table</h2>
      <table className="graph-table">
        <thead>
          <tr>
            <th scope="col">Kind</th>
            <th scope="col">ID</th>
            <th scope="col">Label</th>
            <th scope="col">Authority</th>
            <th scope="col">Base view</th>
            <th scope="col">Overlays</th>
            <th scope="col">Action</th>
          </tr>
        </thead>
        <tbody>
          {tuples.map((tuple) => {
            const key = tuple.kind === 'node' ? tuple.nodeId : tuple.edgeId;
            const selected = tuple.kind === 'node' && tuple.nodeId === selectedNodeId;
            const nodeRef = tuple.kind === 'node' ? nodeRefs.get(tuple.nodeId) : undefined;
            return (
              <tr
                key={key}
                className={selected ? 'graph-row--selected' : undefined}
                data-graph-kind={tuple.kind}
                data-graph-id={key}
                data-graph-label={tuple.label}
                data-graph-authority={tuple.authority}
                data-graph-base-view={tuple.baseViewMembership}
                data-graph-overlays={tuple.overlayMemberships.join(',')}
              >
                <td>{tuple.kind}</td>
                <td>{key}</td>
                <td>{tuple.label}</td>
                <td>{tuple.authority}</td>
                <td>{tuple.baseViewMembership}</td>
                <td>{tuple.overlayMemberships.join(', ')}</td>
                <td>
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
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
};
