# Project Shotgun Cross-store Inventory

## Status

- Inventory scope: Project Shotgun governing text, architecture, contracts, implementation plans, engineering evidence and publication mirrors
- Snapshot date: 2026-07-29
- Canonical authority: `JasonCutter/shotgun` branch `main`
- External stores: Notion and Google Drive are Reference, Mirror or Archive locations

## Inclusion rules

### Git

Every Git-tracked file under `docs/` is included in the inventory. The following supporting governance files are also included:

- `scripts/docs-validation.ts`
- `.github/workflows/ci.yml`
- `package.json` documentation commands

The authoritative Git set is therefore defined by the repository itself rather than by a manually copied filename list:

```text
git ls-files docs scripts/docs-validation.ts .github/workflows/ci.yml package.json
```

### Notion

All Project Shotgun pages reachable under the registered Architecture Design Documents root and Frontend Architecture root are covered by the inventory. Standalone high-value ADR and implementation-plan pages identified during migration are recorded separately in `cross-store-inventory.json`.

### Google Drive

Drive inventory uses Project Shotgun title/keyword searches and explicit known document identifiers. The only governing Shotgun-authored Drive document found in the final search was `Shotgun Knowledge Flow Detailed Map`; unrelated search results are excluded from Project Shotgun scope.

## Classification decision order

1. A reviewed file merged to Git `main` is Canonical when its document class and approval state permit it.
2. A Notion or Drive item already migrated to Git is a Mirror, Legacy Reference or Archive candidate.
3. A conflicting external-only edit is Candidate and cannot replace Git authority.
4. A historical duplicate is retained and classified; it is not silently deleted.
5. Large, licensed, sensitive or binary material may remain external with a safe reference entry.

## Inventory outputs

- Machine-readable inventory: `docs/inventory/cross-store-inventory.json`
- Verification record: `docs/engineering/final-cross-store-inventory-verification-260729001.md`
- Canonical registration: `docs/canonical-manifest.yaml`

## Completion boundary

Cross-store inventory completion means all known Project Shotgun governing roots and Git-tracked documents have an explicit authority rule and external-store classification. It does not mean every unrelated file in the user's Notion or Google Drive workspace belongs to Project Shotgun.