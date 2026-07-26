# Snapshot — Phase 1 Section 2 Settings·Project Administration

- Canonical: [Phase 1 Section 2 — Settings·Project Administration 결정문 (확정)](https://app.notion.com/p/3a65181d71ad81e0aabeff1ec7b6d161)
- Fetched: 2026-07-25T10:47:10.330Z
- Source revision visible to search: 2026-07-25T10:47:00.000Z
- Export scope: contract-relevant visible excerpt

## Confirmed contract

- Settings is a server-authoritative typed Project Policy control plane.
- Scope distinguishes Principal, Project, System, and Resource settings.
- Application modes include `IMMEDIATE`, `CONFIRM_REQUIRED`, `REVIEW_REQUIRED`, `RESTART_REQUIRED`, `MIGRATION_REQUIRED`, `READ_ONLY`, and `UNAVAILABLE`.
- The server supplies risk, application mode, capability, revisions, and impact. The frontend does not infer these from field names or categories.
- Project archive and delete are separate lifecycles. Destructive or policy-weakening operations require elevated confirmation or review.
- Connector secrets remain masked and are not persisted in browser storage.
- Existing Resource mutations bind to the Resource Project, not whichever Project is currently active in the shell.
- `OUTCOME_UNKNOWN` is resolved using `clientRequestId` and idempotency evidence; the browser does not automatically resubmit with a new key.
- Project creation is a principal-scoped administrative command. The server creates identity, owner membership, and initial policy state atomically and does not switch the active Project automatically.
- Settings impact distinguishes future-only effects from actions that must be revalidated under current policy.
- Settings drafts are not restored outside the route or included in Home Continue Working in the initial MVP.

## 2026-07-25 implementation freeze

- The user approved the Section 2 Gap Audit and AC-01 through AC-30 as the fixed implementation criteria.
- No new completion criterion is silently added during implementation.
- Work remains on a separate branch and Draft PR.
- PR Ready, merge, Canonical completion updates, and Phase 1 Section 3 start are prohibited before completion approval.

## Export limitation

The page points to a child document titled “Frontend Phase 1 Section 2 Gap Audit 및 고정 Acceptance Criteria v1.0 (확정)”. That child did not appear as an independently fetchable Notion result on 2026-07-26. The separately preserved AC snapshot records the visible approved matrix and this limitation.
