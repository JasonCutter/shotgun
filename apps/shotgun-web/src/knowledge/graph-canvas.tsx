import { useEffect, useRef } from 'react';
import cytoscape from 'cytoscape';

import type { GraphEdgeV1, GraphNodeReferenceV1, GraphNodeV1 } from '@shotgun/api-client';

type CytoscapeCore = ReturnType<typeof cytoscape>;

/**
 * Cytoscape presentation adapter (AC-18/AC-22).
 *
 * Canvas rendering and layout only. Coordinates, zoom and pan are presentation
 * state that never leaves the browser and are never sent as authority. No
 * write method is exposed; the parent owns selection through the pure state
 * machine. With `prefers-reduced-motion: reduce`, all layout animations are
 * disabled.
 */

const AUTHORITY_CLASS: Record<GraphNodeV1['authority'], string> = {
  CANONICAL: 'authority-canonical',
  DERIVED_INFERENCE: 'authority-derived',
  DISCOVERY_CANDIDATE: 'authority-discovery',
};

const STYLE = [
  {
    selector: 'node',
    style: {
      label: 'data(label)',
      'text-wrap': 'wrap',
      'text-max-width': '120px',
      'font-size': '10px',
      'text-valign': 'bottom',
      'text-halign': 'center',
      width: '24px',
      height: '24px',
      'background-color': '#4f6ef2',
      color: '#1a1a1a',
    },
  },
  {
    selector: 'node.authority-canonical',
    style: { 'background-color': '#2f6f4f', shape: 'round-rectangle' },
  },
  {
    selector: 'node.authority-derived',
    style: { 'background-color': '#8a5cf6', shape: 'ellipse' },
  },
  {
    selector: 'node.authority-discovery',
    style: { 'background-color': '#d99a26', shape: 'diamond' },
  },
  {
    selector: 'node:selected',
    style: { 'border-width': 3, 'border-color': '#111111' },
  },
  {
    selector: 'edge',
    style: {
      width: 2,
      'line-color': '#9aa0b0',
      'target-arrow-shape': 'triangle',
      'curve-style': 'bezier',
    },
  },
  {
    selector: 'edge.authority-canonical',
    style: { 'line-color': '#2f6f4f', 'target-arrow-color': '#2f6f4f' },
  },
  {
    selector: 'edge.authority-derived',
    style: { 'line-color': '#8a5cf6', 'line-style': 'dashed' },
  },
  {
    selector: 'edge.overlay-conflict',
    style: { 'line-color': '#c0392b' },
  },
  {
    selector: 'edge.overlay-gap',
    style: { 'line-color': '#d99a26' },
  },
  {
    selector: 'edge.overlay-impact',
    style: { 'line-color': '#8a5cf6', 'line-style': 'dotted' },
  },
] as const;

const elementsFor = (nodes: readonly GraphNodeV1[], edges: readonly GraphEdgeV1[]) => {
  const nodeElements = nodes
    .filter((node) => node.accessMasking !== 'HIDDEN')
    .map((node) => ({
      data: {
        id: node.nodeId,
        label: node.label,
        resourceKind: node.resourceRef.resourceKind,
        resourceId: node.resourceRef.resourceId,
        authority: node.authority,
      },
      classes: AUTHORITY_CLASS[node.authority],
    }));
  // Edges reference resourceIds; nodes are keyed by nodeId in the canvas.
  // Map each resourceId to its nodeId so edges connect to rendered nodes.
  const nodeIdByResourceId = new Map(
    nodeElements.map(
      (element) => [String(element.data.resourceId), String(element.data.id)] as const,
    ),
  );
  const edgeElements = edges
    .filter((edge) => edge.accessMasking !== 'HIDDEN')
    .map((edge) => {
      const source = nodeIdByResourceId.get(edge.from.resourceId);
      const target = nodeIdByResourceId.get(edge.to.resourceId);
      if (!source || !target) return undefined;
      return {
        data: {
          id: edge.edgeId,
          source,
          target,
          label: edge.edgeSemanticKind,
          authority: edge.authority,
        },
        classes: [
          AUTHORITY_CLASS[edge.authority],
          ...edge.overlayMemberships.map((kind) =>
            kind === 'CONFLICT'
              ? 'overlay-conflict'
              : kind === 'KNOWLEDGE_GAP'
                ? 'overlay-gap'
                : 'overlay-impact',
          ),
        ].join(' '),
      };
    })
    .filter((element): element is NonNullable<typeof element> => element !== undefined);
  return [...nodeElements, ...edgeElements];
};

export const GraphCanvas = ({
  nodes,
  edges,
  selectedRef,
  onSelect,
  ariaLabel,
}: {
  readonly nodes: readonly GraphNodeV1[];
  readonly edges: readonly GraphEdgeV1[];
  readonly selectedRef: GraphNodeReferenceV1 | null;
  readonly onSelect: (ref: GraphNodeReferenceV1) => void;
  readonly ariaLabel: string;
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<CytoscapeCore | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const core = cytoscape({
      container,
      elements: elementsFor(nodes, edges),
      style: STYLE,
      layout: {
        name: 'breadthfirst',
        animate: !reducedMotion,
        animationDuration: reducedMotion ? 0 : 200,
        spacingFactor: 1.2,
      },
      minZoom: 0.25,
      maxZoom: 3,
    });
    cyRef.current = core;

    core.on('tap', 'node', (event) => {
      const resourceId = String(event.target.data('resourceId'));
      const resourceKind = String(
        event.target.data('resourceKind'),
      ) as GraphNodeReferenceV1['resourceKind'];
      onSelectRef.current({ schemaVersion: '1.0.0', resourceKind, resourceId });
    });

    return () => {
      // `destroy` tears down the instance and its listeners; calling
      // `removeListener` separately can throw in StrictMode double-mounting.
      core.destroy();
      cyRef.current = null;
    };
    // Rebuild only when the component mounts; node/edge content changes flow
    // through the parent re-render and the selection effect below.
  }, []);

  useEffect(() => {
    const core = cyRef.current;
    if (!core) return;
    core.elements().removeClass('focused');
    if (selectedRef) {
      core.elements().addClass('focused');
    }
  }, [selectedRef]);

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label={ariaLabel}
      className="graph-canvas"
      data-testid="graph-canvas"
    />
  );
};
