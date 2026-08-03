import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router';

import {
  createFrontendKnowledgeGraphClient,
  type GlobalShellView,
  type GraphBaseViewKindV1,
  type GraphNodeReferenceV1,
  type GraphOverlayKindV1,
  type GraphSnapshotResultV1,
  type GraphUnavailableReasonV1,
} from '@shotgun/api-client';

import { EmptyState } from '../components/empty-state.js';
import { ErrorState } from '../components/error-state.js';
import { LoadingState } from '../components/loading-state.js';
import { GraphCanvas } from '../knowledge/graph-canvas.js';
import { graphSnapshotIsReady, graphSnapshotQueryOptions } from '../knowledge/graph-queries.js';
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

export const GraphWorkspace = () => {
  const { shell } = useOutletContext<{ readonly shell: GlobalShellView }>();
  const graphClient = useMemo(() => createFrontendKnowledgeGraphClient(), []);
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

  const snapshot = useQuery(graphSnapshotQueryOptions(graphClient, shell, snapshotRequest));
  const currentSnapshot = manualSnapshot ?? snapshot.data;

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

  // Deep-link restoration: focus the selected node once the snapshot is ready.
  useEffect(() => {
    if (deepLinkFocus && snapshot.data) {
      const target = snapshot.data.nodes.find(
        (node) => node.resourceRef.resourceId === deepLinkFocus,
      );
      if (target) {
        dispatch({ type: 'RECOVERY_STARTED', targetRef: target.resourceRef });
        dispatch({ type: 'SELECT_NODE', ref: target.resourceRef });
        dispatch({ type: 'RECOVERY_FINISHED' });
        announce(GRAPH_ANNOUNCEMENTS.SELECTION(target.label));
      }
    }
  }, [deepLinkFocus, snapshot.data]);

  const orderedNodeRefs = useMemo(
    () =>
      currentSnapshot?.nodes
        .filter((node) => node.accessMasking !== 'HIDDEN')
        .map((node) => node.resourceRef) ?? [],
    [currentSnapshot],
  );

  const onKeyDown = useCallback(
    (event: globalThis.KeyboardEvent) => {
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
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        event.preventDefault();
        const index = state.focusedRef
          ? orderedNodeRefs.findIndex((ref) => ref.resourceId === state.focusedRef?.resourceId)
          : -1;
        const next = key === 'ArrowDown' ? index + 1 : index - 1;
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

  const nodes = currentSnapshot?.nodes ?? [];
  const edges = currentSnapshot?.edges ?? [];

  if (!shell.activeProject) {
    return (
      <section className="route-page graph-workspace">
        <p className="eyebrow">Graph Workspace</p>
        <h1 tabIndex={-1}>Semantic Graph</h1>
        <EmptyState
          title="Create a Project before opening the Graph"
          description="Graph reads are always bound to a server-authoritative active Project."
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
                {baseView} <kbd>Alt+{index + 1}</kbd>
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
                {overlay} <kbd>Alt+Shift+{index + 1}</kbd>
              </span>
            </label>
          ))}
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
          ariaLabel="Semantic graph list"
        />
      ) : state.viewKind === 'table' ? (
        <GraphTableView
          nodes={nodes}
          edges={edges}
          selectedRef={state.selectedRef}
          onSelect={selectNode}
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
      <p className="graph-scope-note">
        Project: {shell.activeProject.label} · Snapshot: {result.identity.snapshotId} · Revision:{' '}
        {result.identity.projectionRevision}
      </p>
    </section>
  );
};
