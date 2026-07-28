# ADR-117 Git-backed Report Policy Verification

## Record

- Record ID: `adr-117-documentation-policy-verification-260729001`
- Date: 2026-07-29
- Repository: `JasonCutter/shotgun`
- Original local base:
  `280428499b464fd51b2403f0241edc5b86d24fea`
- Reconciled `origin/main` base:
  `4d2497e08ac64a19df72b320b5978f2727104540`
- Working branch: `codex/adr-117-documentation-ssot`
- Draft PR: `https://github.com/JasonCutter/shotgun/pull/31`
- Subject revision: the Git commit containing this record
- Result: documentation clarification Candidate published; local repository
  format Gate failed on unchanged base files; remote CI passed for the
  conflict-resolved policy head

## Scope

The reconciled base already contained `docs/CANONICAL.md` and ADR-117 from
merged PR #23. This change preserves those accepted documents and clarifies
that all durable reports, audits, inspection results, test results,
verification records, and completion evidence require Git-tracked repository
records.

Changed scope:

- `docs/CANONICAL.md`
- `docs/architecture/adr/ADR-117-documentation-source-of-truth-canonicalization-and-publication-boundary.md`
- this verification record

ADR-119 product implementation, product code, database state, runtime
dependencies, and the existing unrelated working-tree document are outside
scope.

## Base Reconciliation

The local checkout initially reported `main` at
`280428499b464fd51b2403f0241edc5b86d24fea`. After Draft PR publication,
`git fetch origin` showed that remote `main` had advanced to
`4d2497e08ac64a19df72b320b5978f2727104540` and already included:

- PR #23, the accepted ADR-117 and documentation SSoT transition
- later approved documentation and ADR revisions through ADR-119
- merged ADR-118 product implementation

The original branch commits `36bf899224233fa3736ef4e76e94b928ad3097aa`
and `fb3640261f1982c741db8ffc668f112249ba0324` were drafted from the stale
local base and produced add/add conflicts in PR #31. The branch was reconciled
with `origin/main` without rewriting the accepted main documents. The
clarification in this record's subject revision is based on the accepted
remote versions.

The Canonical Cutover Record remains `pending`; this clarification does not
declare or complete cutover.

## Remote CI Result

- Tested head: `59ecca5b831f6d8559065860a5e6035f5358c347`
- Workflow: `CI`
- Actions run:
  `https://github.com/JasonCutter/shotgun/actions/runs/30407819255`

| Job              | Result | Evidence                         |
| ---------------- | ------ | -------------------------------- |
| `Quality`        | `PASS` | GitHub Actions job `90437125182` |
| `Frontend`       | `PASS` | GitHub Actions job `90437125218` |
| `Required Gates` | `PASS` | GitHub Actions job `90437466892` |

This remote result applies to the conflict-resolved documentation policy head.
The commit containing this result is an evidence-only follow-up and receives
its own distinct GitHub status checks.

## Verification Results

| Check                                                   | Result            | Evidence                                                                                                                                                    |
| ------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Targeted Prettier check for the three changed documents | `PASS`            | All changed documents use repository Markdown style.                                                                                                        |
| `npm.cmd run format:check`                              | `FAIL`            | Windows local check reports unchanged `origin/main` files `tests/unit/bootstrap.test.ts`, ADR-118, and ADR-119. Those files are excluded from the PR delta. |
| `npm.cmd run test:architecture`                         | `PASS`            | Output: `Architecture boundaries verified.`                                                                                                                 |
| `git diff origin/main --check --`                       | `PASS`            | No whitespace errors in the PR delta against the reconciled base.                                                                                           |
| PR delta scope                                          | `PASS`            | Only the two governing documents and this verification record differ from `origin/main`.                                                                    |
| Documentation policy invariant check                    | `PASS`            | Mandatory Git-backed report language is present and the Cutover Record remains `pending`/null.                                                              |
| `gh auth status`                                        | `PASS`            | Authenticated as active account `JasonCutter` through the Windows keyring.                                                                                  |
| Draft PR state                                          | `PASS`            | PR #31 is open and remains Draft.                                                                                                                           |
| GitHub Actions run `30407819255`                        | `PASS`            | `Quality`, `Frontend`, and `Required Gates` passed for head `59ecca5b831f6d8559065860a5e6035f5358c347`.                                                     |
| `npm run docs:validate`                                 | `NOT_IMPLEMENTED` | No matching package script exists.                                                                                                                          |
| `npm run docs:links`                                    | `NOT_IMPLEMENTED` | No matching package script exists.                                                                                                                          |
| `npm run docs:adr-index`                                | `NOT_IMPLEMENTED` | No matching package script exists.                                                                                                                          |
| `npm run docs:canonical`                                | `NOT_IMPLEMENTED` | No matching package script exists.                                                                                                                          |
| `npm run docs:drift`                                    | `NOT_IMPLEMENTED` | No matching package script exists.                                                                                                                          |

## Evidence State

| Evidence class              | State     | Notes                                                                                                                            |
| --------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Documentation clarification | `PASS`    | The user-requested Git-backed report rule is represented in the three changed documents.                                         |
| Local verification          | `FAIL`    | Targeted format and architecture checks pass, but the required repository-wide format check fails on three unchanged base files. |
| GitHub publication          | `PASS`    | The branch and Draft PR #31 are published in `JasonCutter/shotgun`.                                                              |
| Remote CI                   | `PASS`    | Run `30407819255` passed all three jobs for the conflict-resolved policy head.                                                   |
| Reviewer/user approval      | `PENDING` | The user requested the clarification; PR review is a separate state.                                                             |
| Merge                       | `PENDING` | No merge is authorized or performed by this record.                                                                              |
| Canonical publication       | `PENDING` | Only a reviewed merge into `main` can publish this clarification.                                                                |
| Canonical cutover           | `PENDING` | `cutover_commit`, `approved_by`, and `approved_at` remain null.                                                                  |
| Deployment/production       | `N/A`     | Documentation-governance clarification only.                                                                                     |

## Known Limits

- Repository documentation validation, link, ADR index, Canonical-state, and
  drift scripts are not implemented in `package.json`.
- Windows local `npm.cmd run format:check` fails on three unchanged
  `origin/main` files. This Draft does not modify those out-of-scope files or
  report the local Gate as passed.
- The evidence-only follow-up commit receives a separate remote CI run; it does
  not retroactively change run `30407819255`.
- This record does not approve merge or declare the documentation cutover
  complete.

## Canonical Documentation Impact

```text
Canonical documentation impact: UPDATED
Governing documents:
- docs/CANONICAL.md
- docs/architecture/adr/ADR-117-documentation-source-of-truth-canonicalization-and-publication-boundary.md

Change type:
- clarification
- verification evidence
```
