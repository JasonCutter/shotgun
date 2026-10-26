# Conversation-first desktop layout — 2026-10-26

Status: UI implementation verified locally; pending Canonicalization and release. This is not VP final acceptance.
Base: `main@e4a45a4a`. Scope: frontend presentation and navigation only.

## Product contract and architecture amendment

The owner approved replacing the permanent three-column shell with a left sidebar,
central conversation and bottom composer. This amends ADR-146's frozen shell
regions, not its GUI/slash dual-control, authorization or actionable-warning rules.
ADR-172/173's single knowledge space, intake/question workflow, Evidence,
SourceVersion, historical-answer, budget and recovery contracts remain binding.

- `/` and `/ask` show the conversation workspace. Recent conversations and
  browser-local pins (versioned, principal/knowledge-space scoped; only IDs are stored) appear in the sidebar. A new conversation does not delete
  sources. Drafts remain scoped to the current conversation during navigation.
- Sources and settings use the center. The Ask provider remains mounted so that
  navigation preserves conversation, drafts and ongoing polling.
- Citation navigation retains the existing guarded source URL, pinned version,
  Evidence and typed return target. Only a valid matching conversation citation
  opens the source workspace beside the conversation. Direct source navigation
  remains a normal workspace. Closing returns to the originating citation.
- The composer has an explicit Add Source entry into the existing intake flow.
  It never silently treats an upload as an ephemeral chat attachment.
- Required failures, privacy/egress, unknown outcomes and recovery notices remain
  visible. Settings and available tools retain GUI and shared slash access.

## OSS integration decision before implementation

Existing evaluations and Role Matrix are the starting point:

| Candidate                                      | Reviewed revision/license                                    | Decision and boundary                                                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| https://github.com/ddsyasas/llm-wiki           | `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c`, MIT              | `REFERENCE_ONLY`: intake/Ask/settings UX; no backend, DB, ingest or LLM client.                                                     |
| https://github.com/inkeep/open-knowledge       | `f2834c237639e2cff603817ed88182b33f83cf91`, GPL-3.0-or-later | `REFERENCE_ONLY`: source preservation and contextual evidence patterns; no GPL code, runtime, Yjs or DB.                            |
| Existing Shotgun React/React Router components | Exact versions retained in package-lock.json                 | Reuse AskShellProvider, ConversationPane, GlobalComposer, guarded routes, SourceDetailWorkspace, command registry and localization. |

No package adoption, extraction or fork is necessary: a third-party chat runtime
cannot own Shotgun's conversation/version/permission/return identity. The minimal
new code composes the existing frontend boundaries. Existing upstream
license/security/maintenance findings remain historical reference evidence; no
claim of a fresh upstream security audit is made. Role Matrix assignments remain
unchanged. No dependency, schema, provider policy or migration changes.

## Verification and rollback

Required: frontend types/build, interaction regression tests, citation/source
return and negative-route checks, real browser layout/keyboard/draft verification,
lint/format, architecture and documentation checks. Results recorded below.
No AI calls or production DB/asset operations are needed.

Rollback: revert the frontend and this documentation amendment; sources,
conversations, Evidence, Ledger and authority contracts remain unchanged.

## Local verification results

Subject: `codex/conversation-layout-20261026`, local delta from `main@e4a45a4a`.
Environment: Windows, repository lockfile installed with `npm ci --ignore-scripts`;
React 19.2.8, React Router 8.3.0, Vite 8.1.5, Playwright 1.61.1/Chromium.

| Check                                              | Result  | Evidence and limits                                                                                                                                                                                                                                                                             |
| -------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend suite                                     | PASS    | `npm --workspace @shotgun/web run test -- --reporter=dot`: 409 tests / 50 files.                                                                                                                                                                                                                |
| Final Ask/router/shell regression                  | PASS    | 52 tests / 3 files after the conversation route, draft and pin changes.                                                                                                                                                                                                                         |
| Final focus/shell regression                       | PASS    | 14 tests / 2 files after scroll preservation; keyboard focus retains reading position.                                                                                                                                                                                                          |
| Root and frontend TypeScript                       | PASS    | `npm run typecheck`, `npm run frontend:typecheck`.                                                                                                                                                                                                                                              |
| Production frontend build                          | PASS    | `npm run frontend:build`; existing contract barrel imports produce node:crypto externalization and large chunk notices. No build errors.                                                                                                                                                        |
| Shell/Ask/source/citation/security contracts       | PASS    | 45 tests / 6 files, including the VP product guard.                                                                                                                                                                                                                                             |
| Browser flow                                       | PASS    | `npx playwright test --config playwright.conversation.config.ts`: 5 tests. Real Chromium with isolated HTTP contract fixtures; no DB, assets or AI provider.                                                                                                                                    |
| Browser coverage                                   | PASS    | Center conversation, one composer, new conversation, per-conversation drafts, Add Source entry, settings return, long-answer scroll return, persistent pins/reload, sidebar toggle, Ctrl+K, typed citation return/focus, matching pinned source version and Evidence, 1280/1440/1920px layouts. |
| Security negative paths                            | PASS    | Source route denial renders no source details and makes no source reads. Ask route denial renders no conversation answer or citation. Direct source routes remain normal source workspaces.                                                                                                     |
| Accessibility                                      | PASS    | axe WCAG 2 A/AA on the conversation; keyboard collapse/expand, command discovery and citation return. Not a full audit of every legacy workspace.                                                                                                                                               |
| Architecture                                       | PASS    | `npm run test:architecture`: module boundaries verified.                                                                                                                                                                                                                                        |
| Documentation                                      | PASS    | `npm run docs:validate`: links, ADR, Canonical/evidence registries, work-item/completion and drift checks.                                                                                                                                                                                      |
| Formatting and lint                                | PASS    | ESLint/Prettier on changed sources; `git diff --check`.                                                                                                                                                                                                                                         |
| Golden Corpus / adapter replacement / DB migration | N/A     | No parsing, retrieval, generation, adapter, schema or persistence contract changes. Existing source/citation tests reused.                                                                                                                                                                      |
| Production install, live AI, publish/merge         | NOT_RUN | Outside this local UI validation. No production data or frozen evaluation evidence was accessed.                                                                                                                                                                                                |

Initial failures exposed stale UI expectations and incomplete browser fixture
session/guard/polling envelopes; fixtures now pass the real response decoders.
Route composition was hardened so an Ask loader failure cannot leave answer prose
outside its guarded workspace. A long-answer test also prompted explicit scroll
tracking and focus without scrolling. All five browser cases passed after fixes;
no skipped cases or automatic retries.

## Scope and handoff

- ADR-146 has an explicit dated amendment; original history is retained. The OSS
  Role Matrix assignments remain unchanged, as recorded above.
- Pin IDs persist in versioned browser-local storage scoped to principal/knowledge
  space. They are filtered through the authorized conversation list and are not
  synchronized across browsers. No question or source text is written there.
- Drafts and reading positions survive workspace/conversation navigation while
  the shell remains mounted; reload persistence for drafts is outside this change.
- Screenshot PNGs and traces are generated under `test-results/`; the committed
  test source is the reproducible evidence. Preview images show synthetic fixture
  data, not production knowledge.
- Backend API contracts, VP Ledger, SourceVersion/Evidence, current model/policy,
  egress, budget, recovery and external-action authorization are unchanged.
- The original `C:/dev/shotgun` checkout and its untracked `docs/research/` were
  preserved. No production process was restarted. Main merge and installed-product
  acceptance remain separate approval/release steps under AGENTS.md and ADR-167.

## Desktop launcher diagnosis after owner check

The owner confirmed the desktop shortcut still showed the old UI. Read-only
inspection proves `Desktop/Shotgun.lnk` invokes
`AppData/Local/ShotgunLauncher/Start-Shotgun.ps1` with working directory
`C:/dev/shotgun`. Its ready runtime identifies `main@e4a45a4a` at
`http://127.0.0.1:3000`; it does not execute this development worktree.
The change is therefore implemented and locally tested but not installed.

ADR-167 requires a clean `main` equal to freshly fetched `origin/main` before
building/reusing the desktop runtime. Copying this unmerged SPA into its static
output or redirecting the shortcut to a development branch would bypass that
identity boundary. Under AGENTS.md, push/PR/merge require explicit separate owner
approval. The remaining release path is approved publication/merge, canonical
launcher update/restart, and installed-browser verification with existing data
preserved. No launcher policy, shortcut or production files were changed.

## Authorized release continuation

On 2026-10-26 the owner explicitly approved GitHub publication, PR creation,
main merge and desktop installed-product rollout. Publication and release
verification are now authorized; their results will be recorded after execution.

Release regression inspection found that the historical approved-knowledge
product's browser tests still exercise ADR-146's original shell. The new layout
is selected by the existing server-owned `vp-conversation-layout` presentation capability.
The VP landing route remains Ask-guarded. The historical product retains the
existing Home/Tree/Instrument/Conversation shell and its protected routes. This
reuses the original components rather than rewriting legacy behavior. The new
browser flow starts at `/` to prove the actual VP desktop landing experience.

The read projection advertises `vp-conversation-layout` only when the existing automatic-knowledge composition is active. The older `vp-autonomous-knowledge` capability describes supported knowledge functionality and is not reused as a presentation-mode selector. No backend processing or permission policy changes. The shell contract tests cover active, legacy and no-project cases.

## Required CI security repair

PR #398's first full Quality run failed the existing high-severity npm audit gate.
The UI did not introduce the vulnerable packages; the current advisory database
now flags the existing Vite/undici pins. The gate was not weakened.

- `vite` is pinned to **8.1.6**, upstream commit
  `dade886f0cc17fedf777eff804593d2af182abd4`, MIT. Its existing frontend 8.1.5
  and test-only 8.3.1 copies are deduplicated to the patched 8.1 line via an exact
  override. No major upgrade or new tool is introduced.
- `undici` is pinned to **7.30.1**, npm gitHead
  `7507102a675b082a71437f0a00681e537875556c`, MIT, for jsdom's existing test
  dependency. This does not replace Node's fetch or Shotgun's provider adapter.
- Primary advisories: [Vite Windows editor issue](https://github.com/advisories/GHSA-587h-7wmj-h5pm)
  and [undici response handling](https://github.com/advisories/GHSA-xjj6-f33q-929c).
- `npm run oss:audit` now passes: no high/critical findings. Seven pre-existing
  low/moderate package findings remain; this is not a claim of a clean audit.
- Source Registry adds both exact package/commit/license decisions. Role Matrix
  ownership stays unchanged. Existing build, frontend, adapter/authority contract
  and CI checks are rerun before merge. Rollback reverts manifests and lockfile
  together, without any database operation.

The first historical frontend E2E run passed 90 cases and failed one inaccessible-
conversation case: the same NOT_FOUND notice was rendered in both the center and
conversation pane. Workspace failures now have one owner, the center; the pane
renders no duplicate error. Existing live-AI cases stayed skipped under their
unchanged authorization gates. The complete CI suite is rerun after this fix and
the dependency security patch.

A subsequent full run passed all frontend E2E cases (91 passed, 6 existing live-AI
skips), but the database suite found one calendar-expired fixture among 792
cases: t3-asset-erasure seeded its supposedly active 720-hour lease on
2026-09-23, so it actually expired on 2026-10-23. The fixture now derives active
and expired leases from PostgreSQL CURRENT_TIMESTAMP, preserving the existing
720-hour lease invariant and the rejection assertion. No production erasure,
lease, reset or authorization logic changed. The full required CI is rerun.

## Owner-approved Paper finish

The owner approved the editable Figma conversation/evidence designs, requested
an off-white paper palette, then instructed the agent to finish the actual
product. This continues the explicit publication, PR, main-merge and installed
desktop rollout authorization above. Base: `main@44ed3ba9` (merged PR #398).
This is a presentation finish, not a new VP Stage or final VP acceptance.

- Design source: [conversation](https://www.figma.com/design/2EJrvJhB2ivdCJdT9Wyc4z?node-id=4-2)
  and [contextual evidence](https://www.figma.com/design/2EJrvJhB2ivdCJdT9Wyc4z?node-id=11-6).
  Both are editable, independently authored Shotgun components. Existing local
  layer IDs, palette records and native Figma PNG exports were inspected. Figma
  MCP design-context retrieval hit the Starter call limit; the known authoring
  metadata and final exports are the explicit fallback, not an imported screenshot.
- Palette: paper `#f7f2e8`, surface `#fffcf6`, ink `#302c26`, accent `#73573b`,
  selection `#e7d9bf`, sidebar `#eee5d5`, border `#d8cdb9`. The implementation
  darkens secondary text from `#746a5d` to `#6d6357` because the former failed
  real browser contrast on the translucent sidebar (4.31:1).
- Reuse the existing VP shell, Ask composer, icons, localization and typed
  citation return. Only VP-scoped CSS tokens/layout and the already-localized
  Add Source label change. No invented answer summaries, production questions,
  schema, API, provider, budget, knowledge authority or data changes.
- Floating 20px sidebar/evidence surfaces, 28px two-row composer and warm
  shadows express the approved design. CSS backdrop blur progressively enhances
  opaque fallbacks; reduced-transparency/forced-color preferences disable blur.
  Recovery buttons and status messages keep full-width rows. Historical shell
  mode retains its existing appearance.

Reuse decision: retain the exact existing React/Router lockfile and the previous
`ddsyasas/llm-wiki` (`e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c`, MIT) and
OpenKnowledge (`f2834c237639e2cff603817ed88182b33f83cf91`, GPL-3.0-or-later)
`REFERENCE_ONLY` UX boundaries. No new runtime, dependency, extract, fork or
package license/security/maintenance exposure is introduced. Apple macOS 27 kit
availability/insertion was verified separately, but its supplied assets and SF
fonts are excluded from the Windows/web implementation. Native CSS presentation
extends existing components; a replacement UI runtime would unnecessarily
replace working authority/draft/citation contracts. The OSS Role Matrix is unchanged.

Verification: five existing isolated Chromium flows pass after the contrast fix,
covering draft/pin persistence, Add Source/settings return, citation focus and
pinned Evidence, route-denial negatives, keyboard, long-scroll return and
1280/1440/1920px layouts. The existing axe WCAG 2 A/AA check passes. Frontend
TypeScript and production build pass; only previously recorded crypto/chunk
notices remain. All 409 frontend unit tests (50 files), changed-file lint/format,
architecture, documentation and OSS gates pass. Required CI gates run before merge.
The first full frontend CI run passed 90 cases but exposed a viewport assumption
in the design-width assertion: the isolated config starts at 1440px while the
full config starts at 1280px (the new inset layout correctly leaves a 980px main
pane there). That assertion now explicitly selects its intended 1440px viewport;
the independent 1280/1920px overflow coverage is retained. No assertion is removed.
Golden Corpus, adapter replacement, replay and migration drills are N/A: no
data, event, adapter or processing contract changed. No live AI is invoked.

Rollback: revert this CSS/label/documentation change as one commit and rebuild
through the canonical main launcher; no data migration/reset is involved.
Installed acceptance will check the merged SHA, health, preserved source and
conversation counts, saved-answer read and citation-panel open/close. These
release results are recorded in the PR after execution; local code alone is not
claimed as the installed result.
