import type { GraphEdgeV1, GraphNodeReferenceV1, GraphNodeV1 } from '@shotgun/api-client';

import {
  graphAccessibleTuples,
  graphNodeRefById,
  graphSelectedNodeId,
} from './graph-accessible.js';
import {
  graphBaseViewLabel,
  graphItemKindLabel,
  graphOverlayLabel,
} from '../presentation/product-labels.js';
import { authorityLabel } from './graph-list-view.js';
import { authorityVisualClass } from './graph-list-view.js';

const discoveryDetailHref = (node: GraphNodeV1): string | null =>
  node.payload?.nodeKind === 'DISCOVERY_FINDING'
    ? `${node.payload.detailPath}?revision=${encodeURIComponent(String(node.payload.findingRevision))}`
    : null;

const discoveryEdgeDetailHref = (edge: GraphEdgeV1): string | null => {
  const finding = edge.provenance?.discoveryFindingRef;
  return finding
    ? `/knowledge/discoveries/${encodeURIComponent(finding.findingId)}?revision=${encodeURIComponent(String(finding.findingRevision))}`
    : null;
};

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
    <section role="region" aria-label={ariaLabel} className="graph-table-view" tabIndex={0}>
      <h2 className="visually-hidden">Graph table</h2>
      <table className="graph-table">
        <thead>
          <tr>
            <th scope="col">Kind</th>
            <th scope="col">Type</th>
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
            const node =
              tuple.kind === 'node'
                ? nodes.find((candidate) => candidate.nodeId === tuple.nodeId)
                : undefined;
            const edge =
              tuple.kind === 'edge'
                ? edges.find((candidate) => candidate.edgeId === tuple.edgeId)
                : undefined;
            const detailHref = node
              ? discoveryDetailHref(node)
              : edge
                ? discoveryEdgeDetailHref(edge)
                : null;
            return (
              <tr
                key={key}
                className={`${selected ? 'graph-row--selected' : ''} ${authorityVisualClass(tuple.authority)}`}
                data-graph-kind={tuple.kind}
                data-graph-id={key}
                data-graph-label={tuple.label}
                data-graph-authority={tuple.authority}
                data-graph-base-view={tuple.baseViewMembership}
                data-graph-overlays={tuple.overlayMemberships.join(',')}
              >
                <td>{graphItemKindLabel(tuple.kind)}</td>
                <td>{node?.nodeKind ?? '—'}</td>
                <td>{tuple.label}</td>
                <td>{authorityLabel(tuple.authority)}</td>
                <td>{graphBaseViewLabel(tuple.baseViewMembership)}</td>
                <td>
                  {tuple.overlayMemberships.map(graphOverlayLabel).join(', ')}
                  {node || edge
                    ? ` · Evidence: ${node?.evidence?.evidenceCount ?? edge?.evidence?.evidenceCount ?? 0}`
                    : ''}
                  {detailHref ? (
                    <>
                      {' '}
                      <a href={detailHref}>
                        {node ? 'Discovery detail' : 'Discovery candidate detail'}
                      </a>
                    </>
                  ) : null}
                </td>
                <td>
                  {nodeRef ? (
                    <span className="graph-item-actions">
                      <button type="button" onClick={() => onSelect(nodeRef)}>
                        Select
                      </button>
                      {node?.resourceRef.resourceKind !== 'DISCOVERY_FINDING' ? (
                        <button type="button" onClick={() => onCorrect(nodeRef)}>
                          보정
                        </button>
                      ) : null}
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
