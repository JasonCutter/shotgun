# ADR-117 Documentation Policy Verification

## Record

- Record ID: `adr-117-documentation-policy-verification-260729001`
- Date: 2026-07-29
- Repository: `JasonCutter/shotgun`
- Base branch: `main`
- Base commit: `280428499b464fd51b2403f0241edc5b86d24fea`
- Working branch: `codex/adr-117-documentation-ssot`
- Initial policy commit: `36bf899224233fa3736ef4e76e94b928ad3097aa`
- Draft PR: `https://github.com/JasonCutter/shotgun/pull/31`
- Subject revision: the Git commit containing this record
- Result: documentation Candidate published to GitHub; remote CI pending

## Scope

This record verifies the introduction of:

- `docs/CANONICAL.md`
- `docs/architecture/adr/ADR-117-documentation-source-of-truth-canonicalization-and-publication-boundary.md`

The change requires all durable Shotgun reports and inspection results to be
stored as Git-tracked repository documents. It keeps the Canonical Cutover
Record in `pending` state.

ADR-119 product implementation, product code, database state, runtime
dependencies, and the existing unrelated working-tree document are outside
this verification scope.

## Verification Results

| Check                                                                                                                                                 | Result            | Evidence                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| `npx.cmd prettier --check docs/CANONICAL.md docs/architecture/adr/ADR-117-documentation-source-of-truth-canonicalization-and-publication-boundary.md` | `PASS`            | Both governing documents use the repository Prettier style after a targeted formatting correction.                  |
| Initial targeted Prettier check                                                                                                                       | `FAIL` remediated | Both new files required formatting. `prettier --write` was applied only to those files, and the check then passed.  |
| `npm.cmd run format:check`                                                                                                                            | `PASS`            | All paths covered by the repository script use Prettier style.                                                      |
| `npm.cmd run test:architecture`                                                                                                                       | `PASS`            | Output: `Architecture boundaries verified.`                                                                         |
| `git diff --check`                                                                                                                                    | `PASS`            | No whitespace errors were reported for the tracked diff at the time of the check.                                   |
| Documentation policy invariant check                                                                                                                  | `PASS`            | Both required paths exist, mandatory Git record language is present, and the Cutover Record remains `pending`/null. |
| `gh auth status`                                                                                                                                      | `PASS`            | Authenticated as the active `JasonCutter` account through the Windows keyring with the required repository scope.   |
| `npm run docs:validate`                                                                                                                               | `NOT_IMPLEMENTED` | No matching package script exists.                                                                                  |
| `npm run docs:links`                                                                                                                                  | `NOT_IMPLEMENTED` | No matching package script exists.                                                                                  |
| `npm run docs:adr-index`                                                                                                                              | `NOT_IMPLEMENTED` | No matching package script exists.                                                                                  |
| `npm run docs:canonical`                                                                                                                              | `NOT_IMPLEMENTED` | No matching package script exists.                                                                                  |
| `npm run docs:drift`                                                                                                                                  | `NOT_IMPLEMENTED` | No matching package script exists.                                                                                  |

## Evidence State

| Evidence class         | State     | Notes                                                              |
| ---------------------- | --------- | ------------------------------------------------------------------ |
| Implementation         | `PASS`    | The three documentation files exist on the working branch.         |
| Local verification     | `PASS`    | The checks listed above passed after the recorded formatting fix.  |
| GitHub publication     | `PASS`    | Branch and Draft PR #31 were published to `JasonCutter/shotgun`.   |
| Remote CI              | `PENDING` | GitHub Actions status must be recorded after the final push.       |
| Reviewer/user approval | `PENDING` | Policy direction was requested by the user; PR review is separate. |
| Merge                  | `PENDING` | No merge is authorized or performed by this record.                |
| Canonical publication  | `PENDING` | Only a reviewed merge into `main` can publish the revision.        |
| Canonical cutover      | `PENDING` | `cutover_commit`, `approved_by`, and `approved_at` remain null.    |
| Deployment/production  | `N/A`     | Documentation-governance change only.                              |

## Known Limits

- Repository documentation validation, link, ADR index, Canonical-state, and
  drift scripts are not implemented in `package.json`.
- Remote CI is not a passing result until GitHub Actions completes.
- This record does not approve merge or declare the documentation cutover
  complete.

## Canonical Documentation Impact

```text
Canonical documentation impact: UPDATED
Governing documents:
- docs/CANONICAL.md
- docs/architecture/adr/ADR-117-documentation-source-of-truth-canonicalization-and-publication-boundary.md

Change type:
- new decision requiring approval
- verification evidence
```
