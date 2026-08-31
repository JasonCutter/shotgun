import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useNavigate, useOutletContext, useSearchParams } from 'react-router';

import {
  createFrontendKnowledgeGraphClient,
  type GlobalShellView,
  type GraphBaseViewKindV1,
  type GraphOverlayResultV1,
  type GraphNodeReferenceV1,
  type GraphOverlayKindV1,
  type GraphSnapshotResultV1,
  type GraphUnavailableReasonV1,
} from '@shotgun/api-client';

import { EmptyState } from '../components/empty-state.js';
import { ErrorState } from '../components/error-state.js';
import { LoadingState } from '../components/loading-state.js';
import { TechnicalDetails } from '../components/technical-details.js';
import { graphBaseViewLabel, graphOverlayLabel } from '../presentation/product-labels.js';
import { GraphCanvas } from '../knowledge/graph-canvas.js';
import {
  buildGraphNodeCorrectionSeed,
  graphCorrectionEditorHref,
} from '../knowledge/graph-correction.js';
import {
  graphDiscoveryOverlayQueryOptions,
  graphQueryRetry,
  graphScopeFromShell,
  graphSnapshotIsReady,
} from '../knowledge/graph-queries.js';
import { graphDisabledQueryKey, graphScopeQueryKey } from '../app/query-keys.js';
import { GraphListView } from '../knowledge/graph-list-view.js';
import { GraphPathView } from '../knowledge/graph-path-view.js';
import { GraphTableView } from '../knowledge/graph-table-view.js';
import {
  GRAPH_ANNOUNCEMENTS,
  GRAPH_BASE_VIEWS,
  GRAPH_OVERLAY_KINDS,
  completenessAnnouncement,
  createInitialGraphWorkspaceState,
  failureAnnouncement,
  healthAnnouncement,
  reduceGraphWorkspaceState,
  type GraphViewKind,
} from '../knowledge/graph-workspace-state.js';

/**
 * FE-P3-S3 Graph Workspace (`/knowledge/graph`, guarded).
 *
 * Read-only semantic graph: base-view and overlay selection, snapshot
 * rendering across four information-equivalent views, deep-link restoration
 * and failure recovery. No Canonical/Approval/Action write endpoint is
 * reachable from this workspace.
 */

const baseViewShortcut: Record<number, GraphBaseViewKindV1> = {
  1: 'KNOWLEDGE_SEMANTIC',
  2: 'GOVERNANCE_IMPACT',
  3: 'OPERATIONAL_DEPENDENCY',
};

const overlayShortcut: Record<number, GraphOverlayKindV1> = {
  1: 'CONFLICT',
  2: 'KNOWLEDGE_GAP',
  3: 'RECURSIVE_IMPACT',
};

const viewShortcut: Record<string, GraphViewKind> = {
  l: 'list',
  t: 'table',
  p: 'path',
  v: 'canvas',
};

const viewLabel: Record<GraphViewKind, string> = {
  canvas: 'Canvas',
  list: 'List',
  table: 'Table',
  path: 'Path',
};

const parsePositiveRevision = (value: string | null): number | null => {
  if (!value || !/^[1-9]\d*$/u.test(value)) return null;
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision > 0 ? revision : null;
};

const mergeDiscoveryOverlay = (
  base: GraphSnapshotResultV1,
  overlay: GraphOverlayResultV1,
): GraphSnapshotResultV1 => {
  if (
    overlay.baseSnapshotId !== base.identity.snapshotId ||
    overlay.projectionRevision !== base.identity.projectionRevision ||
    overlay.identity.overlayKind !== 'DISCOVERY' ||
    overlay.health === 'UNAVAILABLE'
  ) {
    return base;
  }
  const nodes = [...base.nodes];
  const edges = [...base.edges];
  const nodeIds = new Set(nodes.map((node) => node.nodeId));
  const edgeIds = new Set(edges.map((edge) => edge.edgeId));
  for (const node of overlay.nodes) {
    if (!nodeIds.has(node.nodeId)) nodes.push(node);
  }
  for (const edge of overlay.edges) {
    if (!edgeIds.has(edge.edgeId)) edges.push(edge);
  }
  return {
    ...base,
    nodes,
    edges,
    overlays: [...base.overlays, overlay.identity],
  };
};

export const GraphWorkspace = () => {
  const { shell } = useOutletContext<{ readonly shell: GlobalShellView }>();
  const graphClient = useMemo(() => createFrontendKnowledgeGraphClient(), []);
  const navigate = useNavigate();
  const [searchParameters] = useSearchParams();
  const [state, dispatch] = useReducer(
    reduceGraphWorkspaceState,
    undefined,
    createInitialGraphWorkspaceState,
  );
  const liveRegionRef = useRef<HTMLParagraphElement | null>(null);
  const [manualSnapshot, setManualSnapshot] = useState<GraphSnapshotResultV1 | null>(null);

  const deepLinkSnapshotId = searchParameters.get('snapshot');
  const deepLinkFocus = searchParameters.get('focus');
  const discoveryFindingId = searchParameters.get('discoveryFinding')?.trim() ?? '';
  const discoveryFindingRevision = parsePositiveRevision(searchParameters.get('discoveryRevision'));

  const snapshotRequest = useMemo(
    () => ({
      schemaVersion: '1.0.0' as const,
      viewKind: state.baseView,
      overlayKinds: state.overlayKinds,
      ...(deepLinkSnapshotId
        ? {
            rootRefs: [
              {
                schemaVersion: '1.0.0' as const,
                resourceKind: 'ENTITY' as const,
                resourceId: deepLinkSnapshotId,
              },
            ],
          }
        : {}),
    }),
    [state.baseView, state.overlayKinds, deepLinkSnapshotId],
  );

  const graphScope = graphScopeFromShell(shell);
  const hasDiscoveryRoot = discoveryFindingId && discoveryFindingRevision !== null;
  const snapshot = useQuery<GraphSnapshotResultV1, unknown>({
    queryKey: graphScope
      ? hasDiscoveryRoot
        ? [
            ...graphScopeQueryKey(graphScope, snapshotRequest),
            'discovery',
            discoveryFindingId,
            discoveryFindingRevision,
          ]
        : graphScopeQueryKey(graphScope, snapshotRequest)
      : graphDisabledQueryKey(hasDiscoveryRoot ? 'discovery-snapshot' : 'snapshot'),
    queryFn: ({ signal }) =>
      hasDiscoveryRoot
        ? graphClient.getDiscoveryGraphSnapshot(
            snapshotRequest,
            discoveryFindingId,
            discoveryFindingRevision,
            { signal },
          )
        : graphClient.getGraphSnapshot(snapshotRequest, { signal }),
    enabled: graphScope !== null && (!hasDiscoveryRoot || discoveryFindingRevision > 0),
    retry: graphQueryRetry,
    staleTime: 15_000,
  });
  const currentSnapshot = manualSnapshot ?? snapshot.data;
  const discoveryOverlayRequest = useMemo(
    () => ({
      schemaVersion: '1.0.0' as const,
      baseSnapshotId: currentSnapshot?.identity.snapshotId ?? '',
      projectionRevision: currentSnapshot?.identity.projectionRevision ?? '',
      overlayKind: 'DISCOVERY' as const,
      findingId: discoveryFindingId,
      findingRevision: discoveryFindingRevision ?? 0,
    }),
    [currentSnapshot, discoveryFindingId, discoveryFindingRevision],
  );
  const discoveryOverlay = useQuery(
    graphDiscoveryOverlayQueryOptions(
      graphClient,
      graphSnapshotIsReady(currentSnapshot) ? graphScope : null,
      discoveryOverlayRequest,
    ),
  );
  const renderedSnapshot = useMemo(
    () =>
      currentSnapshot && discoveryOverlay.data
        ? mergeDiscoveryOverlay(currentSnapshot, discoveryOverlay.data)
        : currentSnapshot,
    [currentSnapshot, discoveryOverlay.data],
  );

  useEffect(() => {
    if (snapshot.isPending) {
      dispatch({ type: 'SNAPSHOT_STARTED' });
      return;
    }
    if (snapshot.isError) {
      const reason: GraphUnavailableReasonV1 = 'NETWORK_FAILURE';
      dispatch({
        type: 'FAILED',
        reason,
        message: snapshot.error instanceof Error ? snapshot.error.message : 'Graph read failed.',
        retryable: true,
      });
      return;
    }
    if (snapshot.data) {
      dispatch({
        type: 'SNAPSHOT_RESOLVED',
        snapshotId: snapshot.data.identity.snapshotId,
        projectionRevision: snapshot.data.identity.projectionRevision,
      });
    }
  }, [snapshot.isPending, snapshot.isError, snapshot.data, snapshot.error]);

  const announce = (message: string) => {
    if (liveRegionRef.current) liveRegionRef.current.textContent = message;
  };

  // AC-17: descriptor-based refresh issues a new snapshot identity and keeps
  // the selected resource focused (or restores an explicit fallback).
  const refresh = useCallback(async () => {
    if (!state.snapshotId || !state.projectionRevision) return;
    dispatch({ type: 'RECOVERY_STARTED' });
    try {
      const refreshed = await graphClient.refreshGraphSnapshot({
        schemaVersion: '1.0.0',
        snapshotId: state.snapshotId,
        projectionRevision: state.projectionRevision,
        expectedSnapshotRevision: state.projectionRevision,
      });
      setManualSnapshot(refreshed);
      dispatch({
        type: 'SNAPSHOT_RESOLVED',
        snapshotId: refreshed.identity.snapshotId,
        projectionRevision: refreshed.identity.projectionRevision,
      });
      if (state.selectedRef) {
        const target = refreshed.nodes.find(
          (node) => node.resourceRef.resourceId === state.selectedRef?.resourceId,
        );
        if (target) {
          dispatch({ type: 'SELECT_NODE', ref: target.resourceRef });
          announce(`${GRAPH_ANNOUNCEMENTS.REFRESH} ${GRAPH_ANNOUNCEMENTS.SELECTION(target.label)}`);
        } else {
          announce(
            `${GRAPH_ANNOUNCEMENTS.REFRESH} ${GRAPH_ANNOUNCEMENTS.DESELECTION(state.selectedRef.resourceId)}`,
          );
        }
      } else {
        announce(GRAPH_ANNOUNCEMENTS.REFRESH);
      }
    } catch (error) {
      dispatch({
        type: 'FAILED',
        reason: 'NETWORK_FAILURE',
        message: error instanceof Error ? error.message : 'Graph refresh failed.',
        retryable: true,
      });
    } finally {
      dispatch({ type: 'RECOVERY_FINISHED' });
    }
  }, [
    state.snapshotId,
    state.projectionRevision,
    state.selectedRef,
    graphClient,
    dispatch,
    announce,
  ]);

  const selectNode = (ref: GraphNodeReferenceV1) => {
    const node = currentSnapshot?.nodes.find((n) => n.resourceRef.resourceId === ref.resourceId);
    dispatch({ type: 'SELECT_NODE', ref });
    if (node) announce(GRAPH_ANNOUNCEMENTS.SELECTION(node.label));
  };

  // AC-25: a correction action on a graph node builds a typed seed carrying
  // the same stable resource ref and navigates to the Knowledge Editor. The
  // seed is a read proposal only: no Canonical write, no Approval, no Action.
  // A HIDDEN node yields no seed (it is filtered from every view anyway).
  const correctNode = useCallback(
    (ref: GraphNodeReferenceV1) => {
      if (!currentSnapshot) return;
      const node = currentSnapshot.nodes.find((n) => n.resourceRef.resourceId === ref.resourceId);
      if (!node) return;
      const seed = buildGraphNodeCorrectionSeed(currentSnapshot, node);
      if (!seed) return;
      announce(GRAPH_ANNOUNCEMENTS.RECOVERY);
      navigate(graphCorrectionEditorHref(seed));
    },
    [currentSnapshot, navigate, announce],
  );

  // Deep-link restoration: focus the selected node once the snapshot is ready.
  useEffect(() => {
    if (deepLinkFocus && renderedSnapshot) {
      const target = renderedSnapshot.nodes.find(
        (node) => node.resourceRef.resourceId === deepLinkFocus,
      );
      if (target) {
        dispatch({ type: 'RECOVERY_STARTED', targetRef: target.resourceRef });
        dispatch({ type: 'SELECT_NODE', ref: target.resourceRef });
        dispatch({ type: 'RECOVERY_FINISHED' });
        announce(GRAPH_ANNOUNCEMENTS.SELECTION(target.label));
      }
    }
  }, [deepLinkFocus, renderedSnapshot]);

  const orderedNodeRefs = useMemo(
    () =>
      currentSnapshot?.nodes
        .filter((node) => node.accessMasking !== 'HIDDEN')
        .map((node) => node.resourceRef) ?? [],
    [currentSnapshot],
  );

  const onKeyDown = useCallback(
    (event: globalThis.KeyboardEvent) => {
      // AC-20: never steal keys while the user is editing text in an input,
      // textarea or contenteditable — arrows and Alt shortcuts must not
      // conflict with normal text entry. Radio/checkbox/button inputs are not
      // text editors and must keep the graph shortcuts working.
      const target = event.target;
      const isTextEditor =
        target instanceof HTMLElement &&
        (target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          (target.tagName === 'INPUT' &&
            !['radio', 'checkbox', 'button', 'submit', 'reset', 'range', 'color'].includes(
              (target as HTMLInputElement).type,
            )));
      if (isTextEditor) {
        return;
      }
      const alt = event.altKey;
      const shift = event.shiftKey;
      const key = event.key;
      if (alt && !shift && key >= '1' && key <= '3') {
        event.preventDefault();
        const baseView = baseViewShortcut[Number(key)];
        if (baseView) dispatch({ type: 'SET_BASE_VIEW', baseView });
        return;
      }
      if (alt && shift && key >= '1' && key <= '3') {
        event.preventDefault();
        const overlay = overlayShortcut[Number(key)];
        if (overlay) dispatch({ type: 'TOGGLE_OVERLAY', overlay });
        return;
      }
      if (alt && !shift && key.toLowerCase() in viewShortcut) {
        event.preventDefault();
        const view = viewShortcut[key.toLowerCase()];
        if (view) {
          dispatch({ type: 'SET_VIEW', view });
          announce(GRAPH_ANNOUNCEMENTS.VIEW(view));
        }
        return;
      }
      if (key === 'Escape') {
        if (state.pathId) {
          event.preventDefault();
          dispatch({ type: 'CLEAR_PATH' });
        } else if (state.viewKind !== 'canvas') {
          event.preventDefault();
          dispatch({ type: 'SET_VIEW', view: 'canvas' });
        }
        return;
      }
      if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(key)) {
        // AC-20: all four arrow keys move node focus within the active region.
        // Down/Right advance; Up/Left go back — the linear list maps the two
        // horizontal keys to the same previous/next semantics as the vertical
        // keys, and at the boundary focus is never lost to the document body.
        event.preventDefault();
        const index = state.focusedRef
          ? orderedNodeRefs.findIndex((ref) => ref.resourceId === state.focusedRef?.resourceId)
          : -1;
        const forward = key === 'ArrowDown' || key === 'ArrowRight';
        const next = forward ? index + 1 : index - 1;
        if (next >= 0 && next < orderedNodeRefs.length) {
          const ref = orderedNodeRefs[next];
          if (ref) dispatch({ type: 'FOCUS_NODE', ref });
        }
        return;
      }
      if (key === 'Enter') {
        if (state.focusedRef) {
          event.preventDefault();
          selectNode(state.focusedRef);
        }
      }
    },
    [state.focusedRef, state.pathId, state.viewKind, orderedNodeRefs, selectNode, announce],
  );

  const onKeyDownRef = useRef(onKeyDown);
  onKeyDownRef.current = onKeyDown;
  useEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => onKeyDownRef.current(event);
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const nodes = renderedSnapshot?.nodes ?? [];
  const edges = renderedSnapshot?.edges ?? [];
  const discoveryOverlayUnavailable =
    discoveryFindingId.length > 0 &&
    discoveryFindingRevision !== null &&
    (discoveryOverlay.isError || discoveryOverlay.data?.health === 'UNAVAILABLE');

  if (!shell.activeProject) {
    return (
      <section className="route-page graph-workspace">
        <p className="eyebrow">Graph Workspace</p>
        <h1 tabIndex={-1}>Semantic Graph</h1>
        <EmptyState
          title="Create a Project before opening the Graph"
          description="Create a Project before opening the graph."
        />
      </section>
    );
  }

  if (state.phase.kind === 'FAILED') {
    return (
      <section className="route-page graph-workspace">
        <p className="eyebrow">Graph Workspace</p>
        <h1 tabIndex={-1}>Semantic Graph</h1>
        <p role="alert">{failureAnnouncement(state.phase.reason)}</p>
        <ErrorState
          error={new Error(state.phase.message)}
          onRetry={() => {
            dispatch({ type: 'RECOVERY_STARTED' });
            void snapshot.refetch().finally(() => dispatch({ type: 'RECOVERY_FINISHED' }));
          }}
        />
      </section>
    );
  }

  if (snapshot.isPending || !graphSnapshotIsReady(currentSnapshot)) {
    return (
      <section className="route-page graph-workspace">
        <p className="eyebrow">Graph Workspace</p>
        <h1 tabIndex={-1}>Semantic Graph</h1>
        <LoadingState message="스냅샷을 불러오는 중" />
      </section>
    );
  }

  const result: GraphSnapshotResultV1 = currentSnapshot!;

  return (
    <section className="route-page graph-workspace" aria-labelledby="graph-workspace-heading">
      <p className="eyebrow">Graph Workspace</p>
      <h1 id="graph-workspace-heading" tabIndex={-1}>
        Semantic Graph
      </h1>

      <p className="visually-hidden" role="status" aria-live="polite" ref={liveRegionRef} />

      <div className="graph-toolbar" role="region" aria-label="Graph view controls">
        <fieldset className="graph-controls-group">
          <legend>Base view</legend>
          {GRAPH_BASE_VIEWS.map((baseView, index) => (
            <label key={baseView}>
              <input
                type="radio"
                name="base-view"
                checked={state.baseView === baseView}
                onChange={() => dispatch({ type: 'SET_BASE_VIEW', baseView })}
              />
              <span>
                {graphBaseViewLabel(baseView)} <kbd>Alt+{index + 1}</kbd>
              </span>
            </label>
          ))}
        </fieldset>

        <fieldset className="graph-controls-group">
          <legend>Overlays</legend>
          {GRAPH_OVERLAY_KINDS.map((overlay, index) => (
            <label key={overlay}>
              <input
                type="checkbox"
                checked={state.overlayKinds.includes(overlay)}
                onChange={() => dispatch({ type: 'TOGGLE_OVERLAY', overlay })}
              />
              <span>
                {graphOverlayLabel(overlay)} <kbd>Alt+Shift+{index + 1}</kbd>
              </span>
            </label>
          ))}
          {discoveryOverlay.data?.identity.overlayKind === 'DISCOVERY' &&
          discoveryOverlay.data.health !== 'UNAVAILABLE' ? (
            <label>
              <input type="checkbox" checked readOnly aria-label="Discovery candidates" />
              <span>{graphOverlayLabel('DISCOVERY')}</span>
            </label>
          ) : null}
        </fieldset>

        <div className="graph-view-switcher" role="group" aria-label="View switcher">
          {(['canvas', 'list', 'table', 'path'] as const).map((view) => (
            <button
              key={view}
              type="button"
              aria-pressed={state.viewKind === view}
              onClick={() => {
                dispatch({ type: 'SET_VIEW', view });
                announce(GRAPH_ANNOUNCEMENTS.VIEW(view));
              }}
            >
              {viewLabel[view]}
            </button>
          ))}
        </div>

        <div className="graph-actions" role="group" aria-label="Graph actions">
          <button type="button" onClick={() => void refresh()}>
            새로 고침
          </button>
        </div>
      </div>

      {healthAnnouncement(result.health) ? (
        <p role="status" className="graph-health-note">
          {healthAnnouncement(result.health)}
        </p>
      ) : null}

      {discoveryOverlayUnavailable ? (
        <p role="status" className="graph-health-note">
          Discovery overlay를 사용할 수 없습니다. 기본 그래프는 계속 표시됩니다.
        </p>
      ) : null}

      {result.truncation ? (
        <p role="status" className="graph-truncation-note">
          {GRAPH_ANNOUNCEMENTS.TRUNCATION(result.truncation)}
        </p>
      ) : null}

      {completenessAnnouncement(result.completeness) ? (
        <p role="status" className="graph-completeness-note">
          {completenessAnnouncement(result.completeness)}
        </p>
      ) : null}

      {state.viewKind === 'canvas' ? (
        <GraphCanvas
          key={`${result.identity.snapshotId}:${result.identity.projectionRevision}`}
          nodes={nodes}
          edges={edges}
          selectedRef={state.selectedRef}
          onSelect={selectNode}
          ariaLabel="Semantic graph canvas"
        />
      ) : state.viewKind === 'list' ? (
        <GraphListView
          nodes={nodes}
          edges={edges}
          selectedRef={state.selectedRef}
          onSelect={selectNode}
          onCorrect={correctNode}
          ariaLabel="Semantic graph list"
        />
      ) : state.viewKind === 'table' ? (
        <GraphTableView
          nodes={nodes}
          edges={edges}
          selectedRef={state.selectedRef}
          onSelect={selectNode}
          onCorrect={correctNode}
          ariaLabel="Semantic graph table"
        />
      ) : (
        <GraphPathView
          nodes={nodes}
          edges={edges}
          path={null}
          description={null}
          selectedRef={state.selectedRef}
          onSelect={selectNode}
          ariaLabel="Semantic graph path"
        />
      )}
      <TechnicalDetails
        items={[
          { label: 'Snapshot ID', value: result.identity.snapshotId },
          { label: 'Projection revision', value: result.identity.projectionRevision },
        ]}
      />
    </section>
  );
};
