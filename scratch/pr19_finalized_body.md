# Draft PR: Frontend Phase 1 Section 1 — Local Owner Session · Authentication · Project Boundary

## Status

```text
PR #19 Status: Draft (Submission Finalized)
Implementation Review: Passed
Merge: 미실행
Canonical: 미반영
Phase 1 Section 2: 미착수
```

---

## Verification Report

- [Frontend Phase 1 Section 1 Verification Report](./docs/engineering/frontend-phase-1-section-1-verification-260724001.md)

---

## 1. Summary

Frontend Phase 1 Section 1 (`Local Owner Session · Authentication · Project Boundary`) implementation candidate. This PR establishes server-authoritative local owner session boundaries, 4-state-axes taxonomy, single-cycle deduplicated local owner bootstrap, typed recovery error screens, project switch leave guards, and protective query cache purging.

---

## 2. Key Technical Implementation Details

- **Runtime Cycle State Isolation**: `SessionCycleState` is explicitly owned per `AppRuntime` (`createSessionCycleState()`). Zero module-global state.
- **Session Recovery State Machine**: 401 detection $\rightarrow$ `REVOKED` $\rightarrow$ `purgeProtectedSessionCaches` $\rightarrow$ `REESTABLISHING` $\rightarrow$ `Bootstrap` $\rightarrow$ `READY` / `UNAVAILABLE`.
- **Deduplicated Manual Reconnect**: Instant `REESTABLISHING` boundary state update, deduplicated `state.activeBootstrapPromise` sharing for concurrent clicks.
- **4-Axis Taxonomy**:
  - `SessionBoundaryConnectivityState`: `'UNKNOWN' | 'ONLINE' | 'OFFLINE'`
  - `SessionBoundaryAuthenticationState`: `'UNKNOWN' | 'authenticated' | 'authentication_required' | 'authentication_unavailable'`
  - `SessionBoundarySessionState`: `'UNKNOWN' | 'ESTABLISHING' | 'REESTABLISHING' | 'READY' | 'REVOKED' | 'UNAVAILABLE'`
  - `SessionBoundaryBackendReadiness`: `'UNKNOWN' | 'READY' | 'DEGRADED' | 'UNAVAILABLE'`
- **API Boundary Authority Path (Option B)**: Raw Session API in `ShotgunApiClient`, boundary controller and recovery state machine exclusively in `apps/shotgun-web/src/session/session-query.ts`.
- **Diagnostic Modal Accessibility & Exact Copy**:
  - Focus trap (Tab / Shift+Tab navigation looping inside modal).
  - Saved triggering element in `lastActiveElementRef` and restored focus upon closing.
  - Escape key dismissal.
  - Copy reflects actual runtime defaults: `HOST=127.0.0.1`, `PORT=3000`, `/api/v1/health` endpoint guidance.
- **Project Switch Leave Guard (Option B — 전환 차단)**:
  - Evaluates `WorkspaceLeaveGuard` before project switch.
  - When `hasUnsavedDraft`, `hasBlockingDialog`, `hasOutcomeUnknownCommand`, or `canLeaveCurrentContext = false` is true, displays warning alert, blocks `switchActiveProject` mutation, and retains active project (no confirmation dialog, no `useBlocker`).
- **Protective Cache Purging**:
  - `purgeProjectScopedCaches(queryClient)` purges query caches matching `['project']` and `['operational-resource-kind-registry']`.
  - `purgeProtectedSessionCaches(queryClient)` purges query caches matching `['session']`, `['product']`, `['project']`, and `['operational-resource-kind-registry']`.

---

## 3. Dependency & Overrides

- `react-router`: `8.3.0`
- `brace-expansion` Override: `5.0.8`
- `minimatch` Override: `10.2.3`

---

## 4. Local Test Results

- `npm run check:core`: PASS (Lint, Format, Typecheck, Unit [87 tests], Contract [143 tests], Integration [29 tests], Architecture)
- `npm run frontend:check`: PASS
  - `frontend:typecheck`: PASS (0 errors)
  - `frontend:test`: PASS (18 tests passed across 5 files)
  - `frontend:build`: PASS (dist artifact generated)
  - `frontend:test:e2e`: PASS (4 Playwright chromium tests passed)
- `npm run oss:audit`: PASS (0 high/critical vulnerabilities)

---

## 5. Operational Restrictions & Next Steps

- **PR State**: Maintained as **Draft PR #19**.
- **Rule Adherence**: No `PR Ready` status, no `Merge`, no `Canonical` merge, and no Phase 1 Section 2 commencement prior to explicit user authorization.
