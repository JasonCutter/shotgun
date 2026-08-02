---
id: FRONTEND-PHASE-3-SECTION-1-A2-C-PRODUCT-CONTRACT-AMENDMENT-AND-IDENTITY-ADDENDUM-260802003
classification: CONTRACT_AMENDMENT_PROPOSAL
status: APPROVED_FOR_A2_C_PERSISTENT_ADAPTER
work_item: FE-P3-S1
sub_slice: A2-C
review_id: 4836723439
review_decision: APPROVED_FOR_A2_C_CONTRACT_AMENDMENT
implementation_authorization: APPROVED_FOR_A2_C_PERSISTENT_ADAPTER
implementation_review_id: 4836838966
decision_basis: USER_SUBMITTED_CONTRACT_SUMMARY
base_commit: ec409b16190f72199556c2c1e01dae513a2387ca
subject_commit: 18f48c4504d1510ad310cd85c00a0a3503ac65e6
branch: codex/frontend-phase-3-section-1-knowledge-workspace
supersedes: docs/implementation/frontend-phase-3-section-1-a2-c-persistent-knowledge-product-read-adapter-implementation-request-260802002.md
---

# FE-P3-S1 A2-C Product Contract Amendment and Identity Addendum

## 1. Decision state

Side-panel review `4836723439` first returned `CHANGES_REQUIRED` for the A2-C
Persistent Knowledge Product Read Adapter request. The follow-up review
returned `APPROVED_FOR_A2_C_CONTRACT_AMENDMENT` for the bounded amendment
content submitted in the review message. A subsequent side-panel review
`4836838966` returned `APPROVED_FOR_A2_C_PERSISTENT_ADAPTER`, authorizing the
Product Search `1.1.0` code and Persistent Adapter within this accepted scope.

The review explicitly recorded that the local amendment commit and file were
not independently available through the connected review surface. This
approval therefore records acceptance of the submitted contract content and
does not claim remote exact-head or local-file verification.

The initial review accepted the document-only preparation commit and the
QX-01/QX-02 reuse and security boundaries, but required these contracts to be
fixed before the adapter could be reconsidered:

1. Preserve all QX-01 readiness fields in the Product response.
2. Define deterministic Product identity rules without fabricated or
   process-local identifiers.
3. Define the authority and deterministic algorithm for read-only Compare
   differences.

This addendum is the accepted bounded contract amendment underlying review
`4836838966`. The implementation decision authorizes only the TypeScript,
schema, test, Product Port adapter, assembly wiring, and applicable validation
described by the accepted scope. API, UI, database migration, PR Ready, Merge,
deployment, and production verification remain unauthorized.

## 2. QX-01 readiness Product mapping

The authoritative QX-01 result is
`SearchKnowledgeWorkspaceResult.readiness`:

- `canonicalSearch`
- `sourceProjections[]`
- `partial`

The Product response must preserve these values as a structured search
readiness object. A single top-level `projection` is not sufficient.

### 2.1 Proposed additive Product shape

The proposed amendment adds a `readiness` member to the Product search result
and extends the Product projection-status value with the QX-01 digest fields.
The existing top-level `projection` remains a compatibility alias for
`readiness.canonicalSearch` during the compatibility period.

```ts
type KnowledgeSearchProjectionStatusView = {
  readonly projectionKind: 'CANONICAL_SEARCH' | 'COMPILED_TRUTH';
  readonly status: 'READY' | 'STALE' | 'DEGRADED' | 'NOT_BUILT';
  readonly canonicalVersion: number;
  readonly projectedCanonicalVersion: number;
  readonly lag: number;
  readonly projectionRevision?: string;
  readonly canonicalSnapshotDigest?: string;
  readonly projectedSnapshotDigest?: string;
  readonly sourceSnapshotDigest?: string;
  readonly projectionLogicalDigest?: string;
  readonly reason?: string;
  readonly updatedAt?: string;
};

type KnowledgeSearchReadinessView = {
  readonly canonicalSearch: KnowledgeSearchProjectionStatusView & {
    readonly projectionKind: 'CANONICAL_SEARCH';
  };
  readonly sourceProjections: readonly KnowledgeSearchProjectionStatusView[];
  readonly partial: boolean;
};
```

The Product search result becomes, in the proposed additive revision:

```ts
type KnowledgeSearchResultViewVNext = Omit<
  KnowledgeSearchResultView,
  'schemaVersion' | 'projection'
> & {
  readonly schemaVersion: '1.1.0';
  readonly projection: KnowledgeSearchProjectionStatusView & {
    readonly projectionKind: 'CANONICAL_SEARCH';
  };
  readonly readiness: KnowledgeSearchReadinessView;
};
```

The proposed Product response revision is exactly `1.1.0` for the search result
only. The existing workspace, page-list, detail, and compare response
contracts remain `1.0.0`. The QX-01 Query envelope and result remain
`SearchKnowledgeWorkspace@1.0.0`; this is an additive Product projection
revision, not a Query revision.

The implementation must add a strict
`decodeKnowledgeSearchResultViewVNext` decoder for `1.1.0`. The existing
strict `decodeKnowledgeSearchResultView` decoder remains unchanged for
`1.0.0`; it must not be silently weakened. During migration, the Product
coordinator must select the versioned decoder from the adapter's declared
response revision, and the `projection` compatibility alias must remain
structurally equal to `readiness.canonicalSearch`.

### 2.2 Exact field mapping

| QX-01 field                     | Product field                                              | Rule                                                                                                                                                                                                                                                                                  |
| ------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `readiness.canonicalSearch`     | `readiness.canonicalSearch` and compatibility `projection` | Map QX `source: CANONICAL_SEARCH` to Product `projectionKind: CANONICAL_SEARCH`; copy status, versions, lag, reason, timestamp and every digest that QX provides. QX fields that do not exist are omitted; no `projectionRevision` is fabricated. `projection` must equal this value. |
| `readiness.sourceProjections[]` | `readiness.sourceProjections[]`                            | Map each QX `source` to the matching Product `projectionKind` and preserve one entry per QX source projection, including status, versions, lag, reason, timestamp and every available digest. Never collapse it into the canonical entry.                                             |
| `readiness.partial`             | `readiness.partial`                                        | Copy the authoritative boolean. Do not recompute it from matches or hide it when matches are empty.                                                                                                                                                                                   |
| QX match `projectionStatus`     | match item lineage projection and search readiness         | Preserve the source-specific status and digest; it does not override the top-level readiness object.                                                                                                                                                                                  |

`partial: true`, an empty source projection, `STALE`, `DEGRADED`, and
`NOT_BUILT` are valid observable read states. They must remain visible in the
Product response. A projection failure must not hide or downgrade a Canonical
match, and a non-ready projection must never be promoted to Canonical or
Approved Knowledge.

### 2.3 Required amendment validation

The approved amendment must add strict decoder and shared-contract coverage for:

- all four readiness states in `canonicalSearch`;
- zero and one source projection, with no duplicate canonical source;
- `partial` consistency with the authoritative QX result;
- every optional digest and reason field;
- unknown readiness fields and malformed status/version/lag combinations;
- empty matches with `partial: true`;
- Canonical results retained while a source projection is non-ready; and
- compatibility alias equality between `projection` and `canonicalSearch`.

## 3. Deterministic Product identity rules

Product IDs are stable projections of source-owned identity tuples. They are
not Canonical IDs and are not stored in a Product table. The implementation
must reuse the existing `sha256Text(stableJson(...))` primitives from
`packages/contracts/src/document-evidence.ts`.

The digest input is an ordered object with named fields, serialized with
`stableJson`; the output is the existing `sha256:<64 lowercase hex>` digest
prefixed by the Product namespace. No UUID, array position, process-local
counter, timestamp, random value, or database-generated Product ID is allowed.

### 3.1 Page identity

```text
pageId = "knowledge-page:v1:" + sha256Text(stableJson({
  projectId,
  resourceId,
  revision,
}))
```

`resourceId` and `revision` are the exact source-owned Product resource
identity selected by the approved mapping; they are never the request's
optional placeholder, an array position, or a generated value. A page ID
changes when Project, resource or resource revision changes and is otherwise
repeatable across processes and adapters.

### 3.2 Authority-specific item identity

`productId` uses the following exact tuple. Every named field is required for
the selected authority; missing source data is a typed contract failure, not
an omitted optional field:

| Authority            | Product identity tuple                                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CANONICAL`          | `projectId`, `authority`, `resourceId`, `resourceRevision`, `canonicalResourceId`, `canonicalRevisionId`, `sourceId`, `sourceVersionId`             |
| `APPROVED_KNOWLEDGE` | `projectId`, `authority`, `resourceId`, `resourceRevision`, `knowledgeGroupId`, `candidateId`, `sourceVersionId`                                    |
| `COMPILED_TRUTH`     | `projectId`, `authority`, `resourceId`, `resourceRevision`, `projectionLogicalDigest`, `compiledItemId`, `canonicalVersion`, `sourceSnapshotDigest` |
| `DERIVED_INFERENCE`  | `projectId`, `authority`, `resourceId`, `resourceRevision`, `inferenceId`, `sourceProjectionDigest`                                                 |

```text
productId = "knowledge-item:v1:" + sha256Text(stableJson(identityTuple))
```

The tuple fields are copied from the accepted Query source without
reinterpretation: Canonical uses the Stage 6 `resourceId`, `resourceRevision`,
`canonicalResourceId`, `canonicalRevisionId`, `sourceId`, and `sourceVersionId`;
Approved Knowledge uses the Stage 9 group resource and revision plus
`knowledgeGroupId`, `candidateId`, and `sourceVersionId`; Compiled Truth uses
the QX-02/Stage 10 item and projection values; and Derived Inference uses the
Stage 10 inference and source-projection values. The mapping must reject a
source whose authority-specific fields cannot be proven.

All fields in the selected authority tuple are required. If the authoritative
Query does not provide one of them, the adapter returns a typed contract error;
it does not omit the field, use a placeholder, or fall back to a different
authority. The authority-specific source tuple remains visible in `lineage`;
hashing it does not promote it to a Canonical identity. Two different
authorities never share a Product identity merely because their labels or text
are equal.

### 3.3 Search match identity

Stage 7 already normalizes search text with Unicode NFKC, lower-casing and
trimming. The Product adapter uses that exact normalized query and no other
ranking or normalization rule:

```text
matchId = "knowledge-match:v1:" + sha256Text(stableJson({
  projectId,
  resourceId,
  revision,
  normalizedQuery,
  productId,
  authority,
  matchType,
}))
```

`rank` and `score` are result values, not identity inputs. A rank change does
not change `matchId`; a second match type for the same Product is a distinct
match. `resourceId`, `revision`, and `authority` bind the match to the
server-returned resource and authority. The query is not exposed as an
authority identifier.

### 3.4 Collision and ordering rules

- The complete named tuple is hashed; omitting a required authority field is a
  contract violation, not a fallback.
- Product IDs are compared as opaque strings and are never parsed as source
  IDs.
- Page and item arrays are sorted by the server-provided order for display;
  identity never depends on array position.
- Any internal collision check must fail closed with a typed contract error;
  it must not append a counter or silently overwrite an item.

## 4. Deterministic read-only Compare contract

No existing Stage Query currently returns Product `differenceId`, `path`,
`kind`, `leftValue`, and `rightValue`. The proposed authority is therefore a
pure Product-layer comparison function executed after both pages have been
read through the same server-authoritative Query path.

It produces no Command, Event, DraftChangeSet, Fact, Canonical mutation,
cross-authority equivalence claim, or write proposal.

### 4.1 Compared fields

Compare operates on the following semantic snapshot and excludes transport or
generated identity fields:

- page `title`;
- page `projection` fields (`projectionKind`, `status`, versions, lag,
  `projectionRevision`, `reason`, and `updatedAt`);
- page `lineage` fields `resourceRevision`, `projectionId`,
  `canonicalResourceId`, `canonicalRevisionId`, `canonicalVersion`, `sourceId`,
  `sourceVersionId`, `evidenceIds`, `commitId`, `manifestId`, `changeSetId`,
  and `projection`;
- each item, matched by `productId`, over `authority`, `kind`,
  `temporalState`, `label`, `summary`, `content`, the same non-identity
  `lineage` fields, and `evidenceTargets`; and
- the declared `capabilities` set after deterministic sorting.

Excluded fields are `schemaVersion`, `fetchedAt`, `pageId`, generated
`productId`, `projectId` fields used only to validate scope, page `resourceId`
and `revision` fields used to bind the request, and the request `focusId`.
Evidence-target resource and revision pins remain compared semantic evidence;
excluding only the page/item scope identity prevents revision-bound Product IDs
or fetch metadata from becoming duplicate content differences.

### 4.2 Canonicalization and paths

- Items are keyed by `productId`; item array order is ignored.
- `evidenceIds`, `capabilities`, and `evidenceTargets` are treated as sets and
  sorted by their complete stable identity tuple before comparison.
- Object keys are normalized by the existing `stableJson` key ordering.
- String values are compared exactly after no whitespace or case rewrite.
  Missing and present values are different.
- Paths use JSON Pointer tokens with the existing `jsonPointerEscape` rule:
  `/title`, `/items/{escapedProductId}/label`, and
  `/items/{escapedProductId}/lineage/sourceVersionId`.
- An item only on the left is `REMOVED`; only on the right is `ADDED`; values
  present on both sides but different are `CHANGED`.
- `leftValue` and `rightValue` contain the stable JSON representation of the
  compared value. For a one-sided path, the absent side is omitted, matching
  the existing strict Product difference decoder; no textual missing sentinel
  is introduced.

Differences are sorted by JSON Pointer path in ascending code-unit order and
then by kind in the fixed order `ADDED`, `REMOVED`, `CHANGED`.

### 4.3 Difference identity

```text
differenceId = "knowledge-difference:v1:" + sha256Text(stableJson({
  projectId,
  leftPageId,
  leftRevision,
  rightPageId,
  rightRevision,
  path,
  kind,
  leftValue,
  rightValue,
}))
```

Left/right order is intentional and part of the identity. The ID is stable for
the same ordered comparison and changes when a compared value or source
revision changes. It never represents a Domain Fact, conflict decision,
Canonical change, or cross-authority identity assertion.

### 4.4 Required Compare validation

The amendment tests must prove:

- repeated comparisons return byte-equivalent results;
- reversing left/right reverses the semantic result and produces distinct IDs;
- item input order does not alter differences or IDs;
- additions, removals, scalar changes, missing values, evidence-set changes,
  projection-status changes and nested JSON Pointer escaping are deterministic;
- a changed Project, revision or authority changes the appropriate identity;
- no `write`, `approve`, `commit`, `action`, or Domain mutation capability is
  reachable from the comparison function; and
- strict decoders reject unknown difference fields and malformed IDs/paths.

## 5. Required re-submission evidence

Before A2-C implementation can be reconsidered, the following must be
submitted and reviewed:

1. An accepted additive Product contract amendment covering Sections 2-4.
2. Strict decoder/schema updates and shared contract tests for readiness,
   identity and Compare.
3. Updated A2-C implementation request mapping every proposed adapter output
   to the accepted contract.
4. Updated PR body with the exact current head and the distinction between the
   approval-request base and subject commit.

This addendum does not authorize those code changes. The next review must
return an explicit decision before the Persistent Adapter is implemented.

## 6. Control state after `APPROVED_FOR_A2_C_CONTRACT_AMENDMENT`

```text
Review 4836723439                 APPROVED_FOR_A2_C_CONTRACT_AMENDMENT
Implementation review 4836838966  APPROVED_FOR_A2_C_PERSISTENT_ADAPTER
Implementation authorization      APPROVED_FOR_A2_C_PERSISTENT_ADAPTER
Approval-request base             ec409b16190f72199556c2c1e01dae513a2387ca
Approval-request subject          18f48c4504d1510ad310cd85c00a0a3503ac65e6
QX-01 Stage 7 Handler             PASS / reviewed
QX-02 Stage 10 Handler             PASS / reviewed
A2-C Contract Amendment           APPROVED / submitted-content basis
A2-C Persistent Adapter           IN PROGRESS
Product Search 1.1.0 Code         IMPLEMENTED LOCALLY / UNDER VALIDATION
A3 API/Client/Cache               NOT AUTHORIZED
/knowledge UI                     NOT AUTHORIZED
PR #53                            OPEN / DRAFT
Ready / Merge                     NOT AUTHORIZED
DB Migration / Dependency        NONE AUTHORIZED
Deployment                        NOT STARTED
```

The implementation pass review remains pending. This authorization does not
permit PR Ready, Merge, deployment, or Phase 3 completion.
