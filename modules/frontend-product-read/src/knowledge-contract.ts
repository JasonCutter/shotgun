import {
  FrontendContractError,
  jsonPointerEscape,
  sha256Text,
  stableJson,
  type KnowledgeAuthority,
  type KnowledgeCompareDifferenceView,
  type KnowledgeDifferenceKind,
  type KnowledgeItemView,
  type KnowledgePageView,
  type KnowledgeSearchMatchType,
} from '../../../packages/contracts/src/index.js';

const contractFailure = (message: string): never => {
  throw new FrontendContractError('UNSUPPORTED_SCHEMA', message);
};

const requiredIdentity = (value: string | undefined, field: string): string => {
  if (value === undefined || value.trim().length === 0) {
    return contractFailure(`Knowledge Product identity requires '${field}'.`);
  }
  return value;
};

const namespacedDigest = (namespace: string, tuple: Record<string, unknown>): string =>
  `${namespace}:v1:${sha256Text(stableJson(tuple))}`;

export const knowledgePageId = (input: {
  readonly projectId: string;
  readonly resourceId: string;
  readonly revision: string;
}): string =>
  namespacedDigest('knowledge-page', {
    projectId: requiredIdentity(input.projectId, 'projectId'),
    resourceId: requiredIdentity(input.resourceId, 'resourceId'),
    revision: requiredIdentity(input.revision, 'revision'),
  });

export const knowledgeProductId = (input: {
  readonly authority: KnowledgeAuthority;
  readonly projectId: string;
  readonly resourceId: string;
  readonly resourceRevision: string;
  readonly canonicalResourceId?: string;
  readonly canonicalRevisionId?: string;
  readonly sourceId?: string;
  readonly sourceVersionId?: string;
  readonly knowledgeGroupId?: string;
  readonly candidateId?: string;
  readonly projectionLogicalDigest?: string;
  readonly compiledItemId?: string;
  readonly canonicalVersion?: number;
  readonly sourceSnapshotDigest?: string;
  readonly inferenceId?: string;
  readonly sourceProjectionDigest?: string;
}): string => {
  const common = {
    projectId: requiredIdentity(input.projectId, 'projectId'),
    authority: input.authority,
    resourceId: requiredIdentity(input.resourceId, 'resourceId'),
    resourceRevision: requiredIdentity(input.resourceRevision, 'resourceRevision'),
  };
  switch (input.authority) {
    case 'CANONICAL':
      return namespacedDigest('knowledge-item', {
        ...common,
        canonicalResourceId: requiredIdentity(input.canonicalResourceId, 'canonicalResourceId'),
        canonicalRevisionId: requiredIdentity(input.canonicalRevisionId, 'canonicalRevisionId'),
        sourceId: requiredIdentity(input.sourceId, 'sourceId'),
        sourceVersionId: requiredIdentity(input.sourceVersionId, 'sourceVersionId'),
      });
    case 'APPROVED_KNOWLEDGE':
      return namespacedDigest('knowledge-item', {
        ...common,
        knowledgeGroupId: requiredIdentity(input.knowledgeGroupId, 'knowledgeGroupId'),
        candidateId: requiredIdentity(input.candidateId, 'candidateId'),
        sourceVersionId: requiredIdentity(input.sourceVersionId, 'sourceVersionId'),
      });
    case 'COMPILED_TRUTH':
      if (input.canonicalVersion === undefined || !Number.isSafeInteger(input.canonicalVersion)) {
        return contractFailure('Knowledge Product identity requires canonicalVersion.');
      }
      return namespacedDigest('knowledge-item', {
        ...common,
        projectionLogicalDigest: requiredIdentity(
          input.projectionLogicalDigest,
          'projectionLogicalDigest',
        ),
        compiledItemId: requiredIdentity(input.compiledItemId, 'compiledItemId'),
        canonicalVersion: input.canonicalVersion,
        sourceSnapshotDigest: requiredIdentity(input.sourceSnapshotDigest, 'sourceSnapshotDigest'),
      });
    case 'DERIVED_INFERENCE':
      return namespacedDigest('knowledge-item', {
        ...common,
        inferenceId: requiredIdentity(input.inferenceId, 'inferenceId'),
        sourceProjectionDigest: requiredIdentity(
          input.sourceProjectionDigest,
          'sourceProjectionDigest',
        ),
      });
  }
};

export const knowledgeMatchId = (input: {
  readonly projectId: string;
  readonly resourceId: string;
  readonly revision: string;
  readonly normalizedQuery: string;
  readonly productId: string;
  readonly authority: KnowledgeAuthority;
  readonly matchType: KnowledgeSearchMatchType;
}): string =>
  namespacedDigest('knowledge-match', {
    projectId: requiredIdentity(input.projectId, 'projectId'),
    resourceId: requiredIdentity(input.resourceId, 'resourceId'),
    revision: requiredIdentity(input.revision, 'revision'),
    normalizedQuery: requiredIdentity(input.normalizedQuery, 'normalizedQuery'),
    productId: requiredIdentity(input.productId, 'productId'),
    authority: input.authority,
    matchType: input.matchType,
  });

export const knowledgeDifferenceId = (input: {
  readonly projectId: string;
  readonly leftPageId: string;
  readonly leftRevision: string;
  readonly rightPageId: string;
  readonly rightRevision: string;
  readonly path: string;
  readonly kind: KnowledgeDifferenceKind;
  readonly leftValue?: string;
  readonly rightValue?: string;
}): string =>
  namespacedDigest('knowledge-difference', {
    projectId: requiredIdentity(input.projectId, 'projectId'),
    leftPageId: requiredIdentity(input.leftPageId, 'leftPageId'),
    leftRevision: requiredIdentity(input.leftRevision, 'leftRevision'),
    rightPageId: requiredIdentity(input.rightPageId, 'rightPageId'),
    rightRevision: requiredIdentity(input.rightRevision, 'rightRevision'),
    path: requiredIdentity(input.path, 'path'),
    kind: input.kind,
    leftValue: input.leftValue,
    rightValue: input.rightValue,
  });

const codeUnitCompare = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const sortedStrings = (values: readonly string[]): readonly string[] =>
  [...values].sort(codeUnitCompare);

const sortedEvidenceTargets = (
  item: KnowledgeItemView,
): readonly NonNullable<KnowledgeItemView['evidenceTargets']>[number][] =>
  [...(item.evidenceTargets ?? [])].sort((left, right) =>
    codeUnitCompare(stableJson(left), stableJson(right)),
  );

const projectionSemantic = (value: KnowledgePageView['projection']): Record<string, unknown> => ({
  projectionKind: value.projectionKind,
  status: value.status,
  canonicalVersion: value.canonicalVersion,
  projectedCanonicalVersion: value.projectedCanonicalVersion,
  lag: value.lag,
  ...(value.projectionRevision === undefined
    ? {}
    : { projectionRevision: value.projectionRevision }),
  ...(value.reason === undefined ? {} : { reason: value.reason }),
  ...(value.updatedAt === undefined ? {} : { updatedAt: value.updatedAt }),
});

const lineageSemantic = (item: KnowledgeItemView): Record<string, unknown> => {
  const lineage = item.lineage;
  return {
    resourceRevision: lineage.resourceRevision,
    ...(lineage.projectionId === undefined ? {} : { projectionId: lineage.projectionId }),
    ...(lineage.canonicalResourceId === undefined
      ? {}
      : { canonicalResourceId: lineage.canonicalResourceId }),
    ...(lineage.canonicalRevisionId === undefined
      ? {}
      : { canonicalRevisionId: lineage.canonicalRevisionId }),
    ...(lineage.canonicalVersion === undefined
      ? {}
      : { canonicalVersion: lineage.canonicalVersion }),
    ...(lineage.sourceId === undefined ? {} : { sourceId: lineage.sourceId }),
    ...(lineage.sourceVersionId === undefined ? {} : { sourceVersionId: lineage.sourceVersionId }),
    ...(lineage.evidenceIds === undefined
      ? {}
      : { evidenceIds: sortedStrings(lineage.evidenceIds) }),
    ...(lineage.knowledgeGroupId === undefined
      ? {}
      : { knowledgeGroupId: lineage.knowledgeGroupId }),
    ...(lineage.candidateId === undefined ? {} : { candidateId: lineage.candidateId }),
    ...(lineage.projectionLogicalDigest === undefined
      ? {}
      : { projectionLogicalDigest: lineage.projectionLogicalDigest }),
    ...(lineage.compiledItemId === undefined ? {} : { compiledItemId: lineage.compiledItemId }),
    ...(lineage.sourceSnapshotDigest === undefined
      ? {}
      : { sourceSnapshotDigest: lineage.sourceSnapshotDigest }),
    ...(lineage.inferenceId === undefined ? {} : { inferenceId: lineage.inferenceId }),
    ...(lineage.sourceProjectionDigest === undefined
      ? {}
      : { sourceProjectionDigest: lineage.sourceProjectionDigest }),
    ...(lineage.commitId === undefined ? {} : { commitId: lineage.commitId }),
    ...(lineage.manifestId === undefined ? {} : { manifestId: lineage.manifestId }),
    ...(lineage.changeSetId === undefined ? {} : { changeSetId: lineage.changeSetId }),
    ...(lineage.projection === undefined
      ? {}
      : { projection: projectionSemantic(lineage.projection) }),
  };
};

const itemSemantic = (item: KnowledgeItemView): Record<string, unknown> => ({
  authority: item.authority,
  kind: item.kind,
  temporalState: item.temporalState,
  label: item.label,
  ...(item.summary === undefined ? {} : { summary: item.summary }),
  ...(item.content === undefined ? {} : { content: item.content }),
  lineage: lineageSemantic(item),
  ...(item.evidenceTargets === undefined ? {} : { evidenceTargets: sortedEvidenceTargets(item) }),
});

const pageSemantic = (page: KnowledgePageView): Record<string, unknown> => ({
  title: page.title,
  projection: projectionSemantic(page.projection),
  lineage: lineageSemantic({
    productId: page.lineage.productId,
    projectId: page.lineage.projectId,
    resourceId: page.resourceId,
    revision: page.revision,
    authority: 'CANONICAL',
    kind: 'CLAIM',
    temporalState: 'CURRENT',
    label: page.title,
    lineage: page.lineage,
  }),
  items: Object.fromEntries(
    [...page.items]
      .sort((left, right) => codeUnitCompare(left.productId, right.productId))
      .map((item) => [item.productId, itemSemantic(item)]),
  ),
  capabilities: sortedStrings(page.capabilities),
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const differenceKindOrder: Record<KnowledgeDifferenceKind, number> = {
  ADDED: 0,
  REMOVED: 1,
  CHANGED: 2,
};

const collectDifferences = (
  left: unknown,
  right: unknown,
  path: string,
  output: Array<{
    readonly path: string;
    readonly kind: KnowledgeDifferenceKind;
    readonly left?: unknown;
    readonly right?: unknown;
  }>,
): void => {
  if (stableJson(left) === stableJson(right)) return;
  if (left === undefined) {
    output.push({ path, kind: 'ADDED', right });
    return;
  }
  if (right === undefined) {
    output.push({ path, kind: 'REMOVED', left });
    return;
  }
  if (isRecord(left) && isRecord(right)) {
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort(codeUnitCompare);
    for (const key of keys) {
      collectDifferences(left[key], right[key], `${path}/${jsonPointerEscape(key)}`, output);
    }
    return;
  }
  output.push({ path, kind: 'CHANGED', left, right });
};

export const compareKnowledgePages = (
  left: KnowledgePageView,
  right: KnowledgePageView,
): readonly KnowledgeCompareDifferenceView[] => {
  if (left.projectId !== right.projectId) {
    return contractFailure('Knowledge Product Compare requires one Project.');
  }
  const raw: Array<{
    readonly path: string;
    readonly kind: KnowledgeDifferenceKind;
    readonly left?: unknown;
    readonly right?: unknown;
  }> = [];
  collectDifferences(pageSemantic(left), pageSemantic(right), '', raw);
  return raw
    .map((difference) => {
      const leftValue = difference.left === undefined ? undefined : stableJson(difference.left);
      const rightValue = difference.right === undefined ? undefined : stableJson(difference.right);
      const path = difference.path || '/';
      return {
        differenceId: knowledgeDifferenceId({
          projectId: left.projectId,
          leftPageId: left.pageId,
          leftRevision: left.revision,
          rightPageId: right.pageId,
          rightRevision: right.revision,
          path,
          kind: difference.kind,
          leftValue,
          rightValue,
        }),
        path,
        kind: difference.kind,
        ...(leftValue === undefined ? {} : { leftValue }),
        ...(rightValue === undefined ? {} : { rightValue }),
      } satisfies KnowledgeCompareDifferenceView;
    })
    .sort(
      (leftDifference, rightDifference) =>
        codeUnitCompare(leftDifference.path, rightDifference.path) ||
        differenceKindOrder[leftDifference.kind] - differenceKindOrder[rightDifference.kind],
    );
};
