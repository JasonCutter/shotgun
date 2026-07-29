# Frontend Phase 1 Section 3 Performance Baseline

- Record ID: `frontend-phase-1-section-3-performance-baseline-260729001`
- Measurement date: 2026-07-29
- Repository: `JasonCutter/shotgun`
- Base SHA: `ec750c91c2a405cfa684bb73eed73e4ad02938c2`
- Implementation Head: `1eccfb380a31b65af1ecf04c58e64150ea52b563`
- Measurement Head: `6df6a2ee6e9d1697311ddac74d94d822ed86098c`
- Branch: `codex/frontend-phase-1-section-3`
- Draft PR: [#42](https://github.com/JasonCutter/shotgun/pull/42)
- Status: **BUDGET_APPROVED**
- Approved budget:
  **Frontend Phase 1 Section 3 Local Product Performance Budget v1.0**
- Approver / approval date: `user / 2026-07-29`
- AC-24: **PASS**
- Artifact aggregate SHA-256:
  `c5c7ef75bfdc3f9a932d50b2f9cb8b1be65392952f62e0ebe49a3b4970084332`
- Final Performance Gate artifact aggregate SHA-256:
  `cbe16ccfb607147d636d459f51dc62ebf283f236e23aa2615d9f659f03463e63`

## 1. Decision boundary

This record supplies the deterministic local Product baseline and the approved
numeric regression budget required for AC-24. The budget is fixed in the
machine-readable
`tests/performance/frontend-section3-local-product-performance-budget-v1.0.json`
contract and enforced by the repository Performance Gate.

This record does not approve the Draft PR Ready transition, merge, Frontend
Phase 1 completion, Phase 2 work, a new runtime dependency, or removal of the
V1 compatibility boundary.

The Server Query number covers authenticated request-context and repository
lookups in the deterministic in-process performance backend. The reset
PostgreSQL database proves migration state, but the performance coordinator and
seed adapters are intentionally in-memory and replaceable. These measurements
are a reproducible local Product gate, not a deployed PostgreSQL, CDN, device,
or production SLO claim.

## 2. Reproduction contract

Command:

```bash
npm run frontend:performance:gate
```

The command:

1. runs `npm run db:reset` through migration 019,
2. builds the production Vite bundle with the E2E-only aggregate performance
   bridge,
3. starts deterministic active-Project and zero-Project Product API fixtures,
4. runs the complete scenario matrix, and
5. writes raw runs, summaries, failures, retry history, bundle digests, and an
   aggregate artifact manifest.

| Concern              | Fixed value                                                  |
| -------------------- | ------------------------------------------------------------ |
| Node / npm           | `v24.15.0` / `11.12.1`                                       |
| Playwright / browser | `1.61.1` / Chromium `149.0.7827.55`                          |
| Build                | production Vite bundle with E2E performance bridge           |
| Desktop              | 1440 x 900, CPU 4x, 10 Mbps down, 2 Mbps up, 40 ms           |
| Mobile               | 390 x 844 touch, CPU 6x, 1.6 Mbps down, 0.75 Mbps up, 150 ms |
| Warm-up              | 3 unrecorded runs per dataset/profile/scenario               |
| Cold                 | 5 runs with fresh Context, storage, and Query Client         |
| Warm                 | 10 runs in the warmed authenticated Context                  |
| Statistics           | median and nearest-rank P95; no outlier removal              |
| Recorded runs        | 600                                                          |
| Measured failures    | 0                                                            |
| Wall time            | 2,716.9 seconds                                              |

`clientRenderMs` is the measured post-final-Product-API-response completion
window until the scenario readiness boundary. It includes client scheduling,
decode-dependent reconciliation, layout, paint-frame stabilization, and
scenario completion; it is not presented as isolated React CPU time.

## 3. Versioned datasets

| Dataset        | Digest                                                             | Source / exposed boundary                                                                                                                |
| -------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Representative | `1627fc93702b45b0a47d9c379fefa06c6f21ab2080b6e462e4f310600583e783` | 25 Projects; Attention 25/25; Continue 25/25; 5 drafts; Recent/Pinned 25/25; Background 50; Notifications 100; Search 10,000/20          |
| Stress         | `53302e706045c99c81b1e23362924ca60253040544769cdd8c554d971becca68` | 250/50 Projects; Attention 100/50; Continue 100/50; 10 drafts; Recent/Pinned 50/50; Background 200; Notifications 500; Search 100,000/20 |

Both datasets include 20% cross-Project candidates and 10%
unavailable/retired/forbidden candidates. The server filters or masks them
before Product API serialization. Client safety caps remain in force.

## 4. Scenario coverage

All ten fixed Section 3 scenarios ran in Representative and Stress, Desktop and
Mobile, Cold and Warm conditions:

1. authorized Global Shell snapshot,
2. zero-Project Shell,
3. Project switch and scoped cache invalidation,
4. Home and Attention first page,
5. Continue Working plus the separate browser-draft group,
6. Notification summary refresh,
7. Global Search and Command Palette,
8. masked Route Guard decision,
9. revision-driven cache purge, and
10. offline/degraded transition.

The current Section 3 Product exposes a bounded Notification summary, not a
Notification detail list or mark-read command. Scenario 6 therefore measures
summary refresh only. It is not evidence for a future Notification detail or
mark-read workflow.

## 5. Observed results

The following are the worst P95 values across both datasets and all ten
scenarios for each profile/cache boundary.

| Metric                     | Desktop Cold | Desktop Warm | Mobile Cold |  Mobile Warm |
| -------------------------- | -----------: | -----------: | ----------: | -----------: |
| Server Query               |      1.27 ms |      1.06 ms |     1.60 ms |      1.00 ms |
| Projection Composition     |      1.44 ms |      1.40 ms |     1.68 ms |      0.83 ms |
| Response Bytes             |      121,638 |       63,051 |     121,638 |       63,051 |
| Network Transfer Bytes     |      123,138 |       63,951 |     123,138 |       63,951 |
| Network Transfer           |   1,834.8 ms |     364.0 ms |  4,120.4 ms |   1,090.6 ms |
| Runtime Decode             |      38.7 ms |      14.3 ms |     84.9 ms |      34.5 ms |
| Client Completion          |   3,840.5 ms |   1,545.5 ms |  9,549.2 ms |   2,994.5 ms |
| Interaction Readiness      |   5,289.9 ms |   1,663.3 ms | 12,462.4 ms |   3,431.1 ms |
| DOM Nodes                  |          661 |          661 |         661 |          661 |
| Query / Active Query Count |        5 / 3 |        5 / 3 |       5 / 3 |        5 / 4 |
| Serialized Query Cache     |     66,942 B |     66,942 B |    66,942 B |     66,942 B |
| Browser Storage            |      3,223 B |      3,223 B |     3,223 B |      3,223 B |
| JS Heap Used               |  8,484,688 B | 19,329,216 B | 9,432,640 B | 18,649,384 B |

Worst Interaction Readiness P95 by scenario:

| Scenario                |   Worst P95 | Boundary                       |
| ----------------------- | ----------: | ------------------------------ |
| 01 Global Shell         |  9,041.1 ms | Stress / Mobile / Cold         |
| 02 Zero Project         |  7,695.8 ms | Representative / Mobile / Cold |
| 03 Project Switch       | 10,833.0 ms | Stress / Mobile / Cold         |
| 04 Home / Attention     |  9,030.4 ms | Stress / Mobile / Cold         |
| 05 Continue / Drafts    | 12,462.4 ms | Stress / Mobile / Cold         |
| 06 Notification Summary |  9,440.8 ms | Stress / Mobile / Cold         |
| 07 Search / Palette     | 10,916.9 ms | Stress / Mobile / Cold         |
| 08 Masked Route Guard   |  9,261.4 ms | Stress / Mobile / Cold         |
| 09 Revision Purge       | 11,953.8 ms | Stress / Mobile / Cold         |
| 10 Offline / Degraded   |  9,549.2 ms | Stress / Mobile / Cold         |

The worst individual measurements were:

- Server Query: 1.597 ms, Stress Mobile Cold revision purge.
- Projection Composition: 1.678 ms, the same boundary.
- Runtime Decode: 84.9 ms, Stress Mobile Cold Project switch.
- Response: 121,638 decoded bytes and 123,138 transfer bytes.
- DOM: 661 nodes.
- Query cache: 5 queries, 4 active, 66,942 serialized bytes.
- Browser storage: 3,223 bytes.
- JS heap: 19,329,216 bytes.

## 6. Bundle baseline

| Asset      | Raw bytes | Direct gzip bytes |                Vite report |
| ---------- | --------: | ----------------: | -------------------------: |
| CSS        |     6,778 |             2,159 |     6.77 kB / 2.17 kB gzip |
| JavaScript |   597,436 |           170,169 | 597.43 kB / 171.86 kB gzip |

The exact JavaScript file SHA-256 is
`1b7d50d98d74b99a98b5471c8641e938784ea6dfde35d9e51300833f62d954b3`.
Vite reports the existing 500 kB chunk warning. The E2E aggregate performance
bridge makes this measured build larger than the uninstrumented Product build.
The final local uninstrumented build reports 594.76 kB / 170.93 kB gzip; the
previous implementation evidence reported 594.38 kB / 170.82 kB gzip. The
bridge does not change the Product authority model.

## 7. Approved numeric budget

Approval name:
`Frontend Phase 1 Section 3 Local Product Performance Budget v1.0`.
The user approved these limits on 2026-07-29. They apply only to the fixed
Representative and Stress seeds, Desktop and Mobile profiles, 10 scenarios,
three warm-ups, five Cold runs, ten Warm runs, and nearest-rank P95 contract.

| Dimension                                    |                           Approved P95 budget |
| -------------------------------------------- | --------------------------------------------: |
| Server Query                                 |                                     <= 2.5 ms |
| Projection Composition                       |                                     <= 2.5 ms |
| Decoded Response                             |                                  <= 140,000 B |
| Network Transfer                             |                                  <= 140,000 B |
| Desktop Cold / Warm Network                  |                          <= 2,250 ms / 500 ms |
| Mobile Cold / Warm Network                   |                        <= 5,000 ms / 1,400 ms |
| Desktop Cold / Warm Runtime Decode           |                              <= 50 ms / 20 ms |
| Mobile Cold / Warm Runtime Decode            |                             <= 110 ms / 45 ms |
| Desktop Cold / Warm Client Completion        |                        <= 5,000 ms / 2,000 ms |
| Mobile Cold / Warm Client Completion         |                       <= 12,000 ms / 4,000 ms |
| Desktop Cold / Warm Interaction Readiness    |                        <= 6,500 ms / 2,100 ms |
| Mobile Cold / Warm Interaction Readiness     |                       <= 15,000 ms / 4,500 ms |
| DOM Nodes                                    |                                        <= 750 |
| Query / Active Query Count                   |                                      <= 6 / 5 |
| Serialized Query Cache                       |                                     <= 80 KiB |
| Browser Storage for measured Section 3 state |                                      <= 4 KiB |
| JS Heap Used                                 |                                     <= 24 MiB |
| JavaScript bundle                            | <= 640,000 raw B and <= 185,000 direct gzip B |

The Gate fails on any budget breach and preserves measured failures,
exclusions, retries, replacement runs, the Artifact Manifest, and aggregate
SHA-256. This is a reproducible Local Product Regression Gate. It is not a
Production, CDN, real-device, deployment, or SLO claim. Notification Detail and
Mark-read are outside this measurement scope.

## 8. Optimization decision

### Route-level code splitting and lazy loading

**RECOMMENDED before adopting a tighter production-oriented cold-start
budget.**

Evidence:

- the application ships one 597,436-byte JavaScript chunk and triggers Vite's
  500 kB warning;
- Mobile Cold Interaction Readiness ranges from 7.70 to 12.46 seconds;
- even the offline/degraded scenario with no Product API response bytes records
  9.55 seconds of Mobile Cold client completion.

The next optimization proposal should use existing React/Vite dynamic imports,
preserve loading/error/focus behavior, and rerun this exact baseline. It does
not require a new runtime dependency. This record does not implement or approve
that follow-up.

### Virtualization

**NOT REQUIRED for the approved Section 3 caps.**

Evidence:

- the maximum observed DOM P95 is 661 nodes;
- maximum heap P95 is 19.33 MB;
- the server and browser registries cap exposed collections before rendering;
- Warm Interaction Readiness remains at or below 3.43 seconds in the Stress
  dataset.

Pagination and caps remain mandatory. Reconsider virtualization only if an
approved DOM, heap, or readiness budget is breached and an accessibility,
keyboard, focus, stable-identity, and replacement test demonstrates a material
benefit.

## 9. Failure and retry evidence

`execution-history.json` preserves the preflight corrections and the first
canonical Scenario 05 failure. The failure was caused by TanStack Query
structural sharing preventing a draft-composition remount; the scenario now
navigates Settings to Home without changing server ranking or authority.

The final canonical run recorded no instrumented failure and
`failures.json` is an empty array. A separate PowerShell invocation using
`npm` was blocked by the local `npm.ps1` execution policy before measurement
started; `npm.cmd` executed the exact repository commands successfully.

After budget approval, the first automated Gate run was preserved at
`260729002`. It recorded 600 valid runs and no measurement failures, but failed
one budget check: Representative / Desktop /
`06-notification-summary-refresh` / Warm Projection Composition P95 was
4.077 ms against the approved 2.5 ms limit. Its aggregate SHA-256 is
`46df69c032a104e1ad4ad089a19eaa6a3deda624d00e6df89877a06f2309c710`.
No run was excluded and the budget was not changed.

A reduced non-canonical diagnostic observed the same Warm path at 1.048 ms.
The official retry used the unchanged measurement contract and was written to
`260729003`, without overwriting the failed run. It passed all 1,133 checks
across 80 groups and 600 valid runs, with zero measurement failures and zero
budget violations. Its verified aggregate SHA-256 is
`cbe16ccfb607147d636d459f51dc62ebf283f236e23aa2615d9f659f03463e63`.

## 10. Artifact inventory

Baseline artifacts are stored in
`artifacts/performance/frontend-phase-1-section-3/260729001/`. The approved
Gate attempt and retry are stored without replacement in `260729002/` and
`260729003/`.

- `environment.json`
- `seed-manifest.json`
- `raw-runs.json`
- `summary.json`
- `failures.json`
- `execution-history.json`
- `bundle.json`
- `performance-budget.json` (approved Gate artifacts)
- `budget-gate.json` (approved Gate artifacts)
- `artifact-manifest.json`

The aggregate digest covers every file except the manifest that records the
digest. Artifacts contain fixed performance labels and aggregate measurements,
not raw Search text, cookies, CSRF tokens, credentials, or protected Product
content.

## 11. AC-24 disposition

- deterministic Representative and Stress datasets: `PASS`
- fixed Desktop and Mobile procedure: `PASS`
- 600 recorded runs with Median/P95 and no outlier removal: `PASS`
- split server/network/decode/client/readiness/DOM/cache/memory evidence:
  `PASS`
- bundle, retry history, and artifact digest: `PASS`
- numeric budget approval: `PASS` — `user / 2026-07-29`
- machine-readable budget and fail-closed evaluator: `PASS`
- final approved Performance Gate: `PASS` — 600 runs, zero failures, zero
  violations, verified Artifact Manifest

AC-24 is `PASS`. Route-level lazy loading remains a recommended, non-blocking
follow-up. Virtualization is not adopted and is reconsidered only after an
actual approved DOM, heap, or readiness budget breach with accessibility
evidence.
