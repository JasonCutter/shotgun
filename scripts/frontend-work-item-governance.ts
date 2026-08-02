import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';

export type WorkItemStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'BLOCKED' | 'COMPLETE';
export type WorkItemType = 'PHASE' | 'SECTION' | 'INCREMENT';

export type FrontendWorkItem = {
  id: string;
  type: WorkItemType;
  title: string;
  parent: string | null;
  predecessor: string | null;
  successor: string | null;
  status: WorkItemStatus;
  governingContract: string;
  completionManifest: string | null;
  approvedAt: string | null;
  supersedes: string | null;
  introducedByDecision: string;
  decisionStatus: 'MIGRATED' | 'CANDIDATE' | 'ACCEPTED';
  decisionApprovedBy: string | null;
  decisionApprovedAt: string | null;
  approvedBy: string | null;
};

export type FrontendWorkItemRegistry = {
  schemaVersion: number;
  governingAdr: string;
  statusAuthority: string;
  items: FrontendWorkItem[];
};

export type CompletionCriterionStatus = 'PASS' | 'FAIL' | 'BLOCKED' | 'PARTIAL' | 'NOT_RUN';

export type FrontendCompletionManifest = {
  schemaVersion: number;
  workItemId: string;
  status: WorkItemStatus;
  governingContract: string;
  mandatoryCriteria: Array<{
    id: string;
    title: string;
    mandatory: boolean;
    status: CompletionCriterionStatus;
    evidence: string[];
    scopeAmendment?: string | null;
  }>;
  remainingScope: Array<{
    id: string;
    description: string;
    trackingId: string;
  }>;
  excludedScope?: Array<{
    id: string;
    description: string;
    trackingId: string;
    scopeAmendment: string;
  }>;
  scopeAmendments: Array<{
    id: string;
    status: 'PROPOSED' | 'APPROVED' | 'REJECTED';
    approvedAt: string | null;
    approvedBy: string | null;
    decisionDocument: string;
    affectedCriteria: string[];
    rationale: string;
    newOwner: string;
    impactAndRollback: string;
    affectedScopeIds: string[];
  }>;
  evidenceRegistryUpdates: string[];
  approvedBy: string | null;
  approvedAt: string | null;
};

type EvidenceRecord = {
  id: string;
  path: string;
  approvedBy?: string;
  approvedAt?: string;
};

function validateLegacyCompletionApproval(
  item: FrontendWorkItem,
  evidence: EvidenceRecord | undefined,
  errors: string[],
): void {
  if (!evidence?.approvedBy) {
    errors.push(`Legacy completion Evidence Registry record for ${item.id} has no approver`);
  }
  if (!evidence?.approvedAt) {
    errors.push(`Legacy completion Evidence Registry record for ${item.id} has no approval date`);
  }
  if (item.approvedBy !== null && item.approvedBy !== evidence?.approvedBy) {
    errors.push(`Legacy completion approval metadata drift for ${item.id}: approvedBy`);
  }
  if (item.approvedAt !== null && item.approvedAt !== evidence?.approvedAt) {
    errors.push(`Legacy completion approval metadata drift for ${item.id}: approvedAt`);
  }
}

const registryPath = 'docs/project/frontend-work-items.json';
const registrySchemaPath = 'docs/project/schemas/frontend-work-item-registry.schema.json';
const schemaPath = 'docs/project/schemas/frontend-completion-manifest.schema.json';
const completionDirectory = 'docs/project/completions';
const evidenceRegistryPath = 'docs/engineering/evidence-registry.json';
const markerStart = '<!-- FRONTEND-WORK-ITEM-STATUS:START -->';
const markerEnd = '<!-- FRONTEND-WORK-ITEM-STATUS:END -->';

export const projectionTargets = [
  'docs/architecture/frontend/README.md',
  'docs/architecture/frontend/phase-2-knowledge-input-question.md',
  'docs/implementation/frontend-phase-1-5-plan-v1.0.md',
  'docs/architecture/add/README.md',
] as const;

export const activeWorkItemDocuments = [...projectionTargets, 'README.md'] as const;

const workItemReferencePattern = /\bFE-P\d+(?:-S[1-9][0-9]*(?:-I[0-9]+)?)?\b/g;
const invalidPhaseTwoSectionPattern = /\b(?:FE-P2-S3|Frontend Phase 2 Section 3)\b/;
const legacyMigratedWorkItemIds = new Set([
  'FE-P1',
  'FE-P1-S1',
  'FE-P1-S2',
  'FE-P1-S3',
  'FE-P2',
  'FE-P2-S1',
  'FE-P2-S2',
  'FE-P2-S2-I01',
  'FE-P2-S2-I02',
  'FE-P2-S2-I03',
  'FE-P3',
  'FE-P3-S1',
  'FE-P3-S2',
  'FE-P3-S3',
  'FE-P4',
  'FE-P4-S1',
  'FE-P4-S2',
  'FE-P5',
  'FE-P5-S1',
  'FE-P5-S2',
]);
const legacyCompletionEvidenceSectionIds = new Set([
  'FE-P1-S1',
  'FE-P1-S2',
  'FE-P1-S3',
  'FE-P2-S1',
]);

type DecisionApprovalMetadata = { approvedBy: string; approvedAt: string };

function parseDecisionApprovalMetadata(text: string): DecisionApprovalMetadata | undefined {
  const approvedBy = /^\s*-\s*Approved by:\s*(?:\*\*)?([^*\n]+?)(?:\*\*)?\s*$/im
    .exec(text)?.[1]
    ?.trim();
  const approvedAt =
    /^\s*-\s*Approved at:\s*(?:\*\*)?([0-9]{4}-[0-9]{2}-[0-9]{2})(?:\*\*)?\s*$/im.exec(text)?.[1];
  if (!approvedBy || !approvedAt || /^(?:not yet approved|none|null)$/i.test(approvedBy)) {
    return undefined;
  }
  return { approvedBy, approvedAt };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isWorkItem(value: unknown): value is FrontendWorkItem {
  if (!isRecord(value)) return false;
  const requiredStrings = ['id', 'type', 'title', 'status', 'governingContract'];
  if (!requiredStrings.every((key) => typeof value[key] === 'string')) return false;
  const nullableStrings = [
    'parent',
    'predecessor',
    'successor',
    'completionManifest',
    'approvedAt',
    'supersedes',
    'decisionApprovedBy',
    'decisionApprovedAt',
    'approvedBy',
  ];
  return (
    nullableStrings.every((key) => value[key] === null || typeof value[key] === 'string') &&
    typeof value.introducedByDecision === 'string' &&
    ['MIGRATED', 'CANDIDATE', 'ACCEPTED'].includes(String(value.decisionStatus))
  );
}

export function collectWorkItemErrors(
  registry: FrontendWorkItemRegistry,
  activeDocuments: Record<string, string> = {},
  pathExists: (relativePath: string) => boolean = () => true,
  readText: (relativePath: string) => string | undefined = () => undefined,
): string[] {
  const errors: string[] = [];
  const items = Array.isArray(registry.items) ? registry.items : [];
  const byId = new Map<string, FrontendWorkItem>();

  for (const candidate of items) {
    if (!isWorkItem(candidate)) {
      errors.push(`Invalid Work Item entry: ${JSON.stringify(candidate)}`);
      continue;
    }
    if (byId.has(candidate.id)) errors.push(`Duplicate Frontend Work Item ID: ${candidate.id}`);
    byId.set(candidate.id, candidate);
    if (!['PHASE', 'SECTION', 'INCREMENT'].includes(candidate.type)) {
      errors.push(`Invalid Work Item type for ${candidate.id}: ${candidate.type}`);
    }
    if (!['NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'COMPLETE'].includes(candidate.status)) {
      errors.push(`Invalid Work Item status for ${candidate.id}: ${candidate.status}`);
    }
    const expectedIdPattern =
      candidate.type === 'PHASE'
        ? /^FE-P[1-5]$/
        : candidate.type === 'SECTION'
          ? /^FE-P[1-5]-S[1-9][0-9]*$/
          : /^FE-P[1-5]-S[1-9][0-9]*-I[0-9]+$/;
    if (!expectedIdPattern.test(candidate.id)) {
      errors.push(`Work Item ID/type mismatch for ${candidate.id}: ${candidate.type}`);
    }
    if (!candidate.introducedByDecision) {
      errors.push(`Work Item ${candidate.id} has no introducing decision`);
    }
    if (!pathExists(candidate.introducedByDecision)) {
      errors.push(
        `Introducing decision does not exist for ${candidate.id}: ${candidate.introducedByDecision}`,
      );
    } else {
      const decisionText = readText(candidate.introducedByDecision);
      if (decisionText !== undefined) {
        const expectedDecisionPattern =
          candidate.decisionStatus === 'MIGRATED'
            ? /Decision status:\s*(?:\*\*)?MIGRATED\b/i
            : candidate.decisionStatus === 'ACCEPTED'
              ? /(?:Decision status:\s*(?:\*\*)?ACCEPTED\b|Status:\s*\*\*Accepted\*\*)/i
              : /(?:Decision status:\s*(?:\*\*)?CANDIDATE\b|Status:\s*\*\*(?:Proposed|Candidate))/i;
        if (!expectedDecisionPattern.test(decisionText)) {
          errors.push(
            `Work Item ${candidate.id} decision status does not match ${candidate.introducedByDecision}`,
          );
        }
        if (candidate.decisionStatus === 'ACCEPTED') {
          const approval = parseDecisionApprovalMetadata(decisionText);
          if (!approval) {
            errors.push(
              `Accepted Work Item ${candidate.id} decision document has no machine-readable approval metadata`,
            );
          } else if (
            candidate.decisionApprovedBy !== approval.approvedBy ||
            candidate.decisionApprovedAt !== approval.approvedAt
          ) {
            errors.push(
              `Accepted Work Item ${candidate.id} approval metadata does not match ${candidate.introducedByDecision}`,
            );
          }
        }
      }
    }
    if (candidate.decisionStatus === 'MIGRATED' && !legacyMigratedWorkItemIds.has(candidate.id)) {
      errors.push(`New Work Item ${candidate.id} cannot use MIGRATED decision status`);
    }
    if (candidate.decisionStatus === 'CANDIDATE' && candidate.status !== 'NOT_STARTED') {
      errors.push(`Candidate Work Item ${candidate.id} must remain NOT_STARTED`);
    }
    if (
      ['MIGRATED', 'CANDIDATE'].includes(candidate.decisionStatus) &&
      (candidate.decisionApprovedBy !== null || candidate.decisionApprovedAt !== null)
    ) {
      errors.push(
        `Work Item ${candidate.id} cannot have Decision approval metadata before ACCEPTED`,
      );
    }
    if (
      candidate.decisionStatus === 'ACCEPTED' &&
      (!candidate.decisionApprovedBy || !candidate.decisionApprovedAt)
    ) {
      errors.push(
        `Accepted Work Item ${candidate.id} requires Decision approver and approval date`,
      );
    }
    if (!pathExists(candidate.governingContract)) {
      errors.push(
        `Governing contract does not exist for ${candidate.id}: ${candidate.governingContract}`,
      );
    }
    if (candidate.completionManifest && !pathExists(candidate.completionManifest)) {
      errors.push(
        `Completion manifest does not exist for ${candidate.id}: ${candidate.completionManifest}`,
      );
    }
  }

  for (const item of byId.values()) {
    if (item.parent && !byId.has(item.parent)) {
      errors.push(`Unregistered parent for ${item.id}: ${item.parent}`);
    }
    const parent = item.parent ? byId.get(item.parent) : undefined;
    if (item.type === 'PHASE' && item.parent !== null) {
      errors.push(`PHASE Work Item ${item.id} must not have a parent`);
    }
    if (item.type === 'SECTION' && parent?.type !== 'PHASE') {
      errors.push(`SECTION Work Item ${item.id} must have a PHASE parent`);
    }
    if (item.type === 'INCREMENT' && parent?.type !== 'SECTION') {
      errors.push(`INCREMENT Work Item ${item.id} must have a SECTION parent`);
    }
    for (const [relationship, relatedId] of [
      ['predecessor', item.predecessor],
      ['successor', item.successor],
    ] as const) {
      if (relatedId && !byId.has(relatedId)) {
        errors.push(`Unregistered ${relationship} for ${item.id}: ${relatedId}`);
      }
    }
    if (item.predecessor) {
      const predecessor = byId.get(item.predecessor);
      if (predecessor && predecessor.successor !== item.id) {
        errors.push(
          `Predecessor/successor mismatch: ${item.id} points to ${item.predecessor}, but reciprocal successor is ${String(predecessor.successor)}`,
        );
      }
    }
    if (item.successor) {
      const successor = byId.get(item.successor);
      if (successor && successor.type !== item.type) {
        errors.push(`Successor type mismatch: ${item.id} points to ${item.successor}`);
      }
      if (successor?.decisionStatus === 'CANDIDATE') {
        errors.push(`Candidate Work Item ${successor.id} cannot be a canonical successor`);
      }
      if (successor && successor.predecessor !== item.id) {
        errors.push(
          `Successor/predecessor mismatch: ${item.id} points to ${item.successor}, but reciprocal predecessor is ${String(successor.predecessor)}`,
        );
      }
    }
    if (item.predecessor && byId.get(item.predecessor)?.decisionStatus === 'CANDIDATE') {
      errors.push(`Candidate Work Item ${item.predecessor} cannot be a canonical predecessor`);
    }
    if (
      item.decisionStatus === 'CANDIDATE' &&
      (item.predecessor !== null || item.successor !== null)
    ) {
      errors.push(`Candidate Work Item ${item.id} cannot participate in the canonical graph`);
    }
  }

  const canonicalItems = items.filter(
    (item) => item.decisionStatus === 'MIGRATED' || item.decisionStatus === 'ACCEPTED',
  );
  const phases = canonicalItems.filter((item) => item.type === 'PHASE');
  const validateLinearGraph = (graphItems: FrontendWorkItem[], label: string): void => {
    const graphIds = new Set(graphItems.map((item) => item.id));
    const starts = graphItems.filter(
      (item) => !item.predecessor || !graphIds.has(item.predecessor),
    );
    const ends = graphItems.filter((item) => !item.successor || !graphIds.has(item.successor));
    if (graphItems.length > 0 && starts.length !== 1) {
      errors.push(`${label} graph must have exactly one start; found ${starts.length}`);
    }
    if (graphItems.length > 0 && ends.length !== 1) {
      errors.push(`${label} graph must have exactly one end; found ${ends.length}`);
    }
    for (const item of graphItems) {
      const visited = new Set<string>();
      let current: FrontendWorkItem | undefined = item;
      while (current?.successor) {
        if (visited.has(current.id)) {
          errors.push(`${label} graph contains a cycle at ${current.id}`);
          break;
        }
        visited.add(current.id);
        if (!graphIds.has(current.successor)) break;
        current = byId.get(current.successor);
      }
    }
    if (starts.length === 1) {
      const reached = new Set<string>();
      let current: FrontendWorkItem | undefined = starts[0];
      while (current) {
        if (reached.has(current.id)) break;
        reached.add(current.id);
        current = current.successor ? byId.get(current.successor) : undefined;
      }
      for (const item of graphItems) {
        if (!reached.has(item.id))
          errors.push(`${label} graph has unreachable Work Item: ${item.id}`);
      }
    }
  };

  validateLinearGraph(phases, 'Phase');
  validateLinearGraph(
    canonicalItems.filter((item) => item.type === 'SECTION'),
    'Section',
  );
  for (const phase of phases) {
    const sections = canonicalItems.filter(
      (item) => item.type === 'SECTION' && item.parent === phase.id,
    );
    validateLinearGraph(sections, `Section group ${phase.id}`);
  }
  for (const section of canonicalItems.filter((item) => item.type === 'SECTION')) {
    const increments = canonicalItems.filter(
      (item) => item.type === 'INCREMENT' && item.parent === section.id,
    );
    if (increments.length > 0) validateLinearGraph(increments, `Increment group ${section.id}`);
  }

  for (const section of canonicalItems.filter((item) => item.type === 'SECTION')) {
    const phaseId = /^FE-P[1-5]-S/.exec(section.id)?.[0]?.replace(/-S$/, '');
    if (phaseId && section.parent !== phaseId) {
      errors.push(`Section ${section.id} parent does not match its Phase ID: ${section.parent}`);
    }
  }
  for (const increment of canonicalItems.filter((item) => item.type === 'INCREMENT')) {
    const sectionId = increment.id.match(/^FE-P[1-5]-S[1-9][0-9]*/)?.[0];
    if (sectionId && increment.parent !== sectionId) {
      errors.push(
        `Increment ${increment.id} parent does not match its Section ID: ${increment.parent}`,
      );
    }
  }

  const activeSections = canonicalItems.filter(
    (item) => item.type === 'SECTION' && item.status === 'IN_PROGRESS',
  );
  if (activeSections.length > 1) {
    errors.push(
      `More than one Frontend Section is IN_PROGRESS: ${activeSections.map((item) => item.id).join(', ')}`,
    );
  }

  const activePhases = phases.filter((item) => item.status === 'IN_PROGRESS');
  if (activePhases.length > 1) {
    errors.push(
      `More than one Frontend Phase is IN_PROGRESS: ${activePhases.map((item) => item.id).join(', ')}`,
    );
  }
  for (const phase of phases) {
    const children = canonicalItems.filter(
      (item) => item.type === 'SECTION' && item.parent === phase.id,
    );
    if (children.length === 0) continue;
    const allChildrenComplete = children.every((child) => child.status === 'COMPLETE');
    if (allChildrenComplete && phase.status !== 'COMPLETE') {
      errors.push(`Phase ${phase.id} must be COMPLETE when all child Sections are COMPLETE`);
    }
    if (!allChildrenComplete && phase.status === 'COMPLETE') {
      errors.push(`Phase ${phase.id} cannot be COMPLETE while a child Section is incomplete`);
    }
    if (
      children.some((child) => child.status === 'IN_PROGRESS') &&
      phase.status !== 'IN_PROGRESS'
    ) {
      errors.push(`Phase ${phase.id} must be IN_PROGRESS while a child Section is IN_PROGRESS`);
    }
    if (phase.predecessor) {
      const predecessor = byId.get(phase.predecessor);
      if (predecessor && predecessor.status !== 'COMPLETE' && phase.status !== 'NOT_STARTED') {
        errors.push(
          `Phase ${phase.id} cannot start before predecessor ${phase.predecessor} is COMPLETE`,
        );
      }
    }
  }
  for (const section of canonicalItems.filter((item) => item.type === 'SECTION')) {
    if (section.predecessor) {
      const predecessor = byId.get(section.predecessor);
      if (predecessor && predecessor.status !== 'COMPLETE' && section.status !== 'NOT_STARTED') {
        errors.push(
          `Section ${section.id} cannot start before predecessor ${section.predecessor} is COMPLETE`,
        );
      }
    }
  }

  for (const [documentPath, text] of Object.entries(activeDocuments)) {
    if (invalidPhaseTwoSectionPattern.test(text)) {
      errors.push(`Invalid active Phase 2 Section reference in ${documentPath}`);
    }
    for (const match of text.matchAll(workItemReferencePattern)) {
      const reference = match[0];
      if (!byId.has(reference)) {
        errors.push(`Unregistered Frontend Work Item reference in ${documentPath}: ${reference}`);
      }
    }
  }

  return errors;
}

export function collectCompletionInvariantErrors(
  registry: FrontendWorkItemRegistry,
  manifests: Record<string, FrontendCompletionManifest>,
  evidenceRecords: EvidenceRecord[],
  pathExists: (relativePath: string) => boolean = () => true,
  readText: (relativePath: string) => string | undefined = () => undefined,
): string[] {
  const errors: string[] = [];
  const byId = new Map(registry.items.map((item) => [item.id, item]));
  const canonicalById = new Map(
    registry.items
      .filter((item) => item.decisionStatus === 'MIGRATED' || item.decisionStatus === 'ACCEPTED')
      .map((item) => [item.id, item]),
  );
  const evidenceById = new Map(evidenceRecords.map((record) => [record.id, record]));
  const evidenceByPath = new Map(evidenceRecords.map((record) => [record.path, record]));
  const evidencePaths = new Set(evidenceRecords.map((record) => record.path));

  for (const item of registry.items.filter((candidate) => candidate.type === 'SECTION')) {
    const manifest = manifests[item.id];
    const completionEvidence = item.completionManifest
      ? evidenceByPath.get(item.completionManifest)
      : undefined;
    const completionApprovedBy = manifest
      ? (item.approvedBy ?? completionEvidence?.approvedBy ?? null)
      : (completionEvidence?.approvedBy ?? null);
    const completionApprovedAt = manifest
      ? (item.approvedAt ?? completionEvidence?.approvedAt ?? null)
      : (completionEvidence?.approvedAt ?? null);

    if (item.status === 'COMPLETE') {
      if (!item.completionManifest) {
        errors.push(`COMPLETE Section ${item.id} has no completion manifest or evidence record`);
      } else if (!evidencePaths.has(item.completionManifest)) {
        errors.push(
          `COMPLETE Section ${item.id} completion status lacks an Evidence Registry update for ${item.completionManifest}`,
        );
      }
      if (!manifest) validateLegacyCompletionApproval(item, completionEvidence, errors);
      if (!completionApprovedBy)
        errors.push(`COMPLETE Section ${item.id} has no completion approver`);
      if (!completionApprovedAt) errors.push(`COMPLETE Section ${item.id} has no approval date`);
      if (!manifest && !legacyCompletionEvidenceSectionIds.has(item.id)) {
        errors.push(
          `COMPLETE Section ${item.id} requires a JSON completion manifest; legacy evidence is not allowed for new Sections`,
        );
      }
    }

    if (item.completionManifest?.endsWith('.json') && !manifest) {
      errors.push(`Missing JSON completion manifest for ${item.id}: ${item.completionManifest}`);
    }
    if (!manifest) continue;

    if (manifest.workItemId !== item.id) {
      errors.push(`Completion manifest identity mismatch for ${item.id}: ${manifest.workItemId}`);
    }
    if (manifest.status !== item.status) {
      errors.push(
        `Registry/completion manifest status drift for ${item.id}: ${item.status} != ${manifest.status}`,
      );
    }
    if (!pathExists(manifest.governingContract)) {
      errors.push(
        `Completion manifest contract does not exist for ${item.id}: ${manifest.governingContract}`,
      );
    }

    const duplicateAmendmentIds = new Set<string>();
    const amendmentById = new Map<string, (typeof manifest.scopeAmendments)[number]>();
    for (const amendment of manifest.scopeAmendments) {
      if (amendmentById.has(amendment.id)) {
        duplicateAmendmentIds.add(amendment.id);
        errors.push(
          `Completion manifest ${item.id} has duplicate Scope Amendment ID: ${amendment.id}`,
        );
      } else {
        amendmentById.set(amendment.id, amendment);
      }
    }
    const approvedAmendments = new Map<string, (typeof manifest.scopeAmendments)[number]>();
    const criterionIds = new Set(manifest.mandatoryCriteria.map((criterion) => criterion.id));
    const remainingIds = new Set(manifest.remainingScope.map((scope) => scope.id));
    const excludedIds = new Set((manifest.excludedScope ?? []).map((scope) => scope.id));
    const allScopeIds = [...criterionIds, ...remainingIds, ...excludedIds];
    if (new Set(allScopeIds).size !== allScopeIds.length) {
      errors.push(`Completion manifest ${item.id} reuses a Criterion or scope ID`);
    }
    const remainingTrackingIds = new Set(manifest.remainingScope.map((scope) => scope.trackingId));
    for (const excluded of manifest.excludedScope ?? []) {
      if (remainingTrackingIds.has(excluded.trackingId)) {
        errors.push(
          `Completion manifest ${item.id} tracks the same scope in remainingScope and excludedScope: ${excluded.trackingId}`,
        );
      }
    }

    const usedAmendments = new Set<string>();
    for (const amendment of manifest.scopeAmendments) {
      let authoritativeApprovedAmendment =
        amendment.status === 'APPROVED' &&
        Boolean(amendment.approvedAt) &&
        Boolean(amendment.approvedBy) &&
        !duplicateAmendmentIds.has(amendment.id);
      if (!pathExists(amendment.decisionDocument)) {
        errors.push(
          `Scope Amendment ${item.id}/${amendment.id} decision document does not exist: ${amendment.decisionDocument}`,
        );
        authoritativeApprovedAmendment = false;
      } else if (amendment.status === 'APPROVED') {
        if (!amendment.approvedAt || !amendment.approvedBy) {
          errors.push(
            `Scope Amendment ${item.id}/${amendment.id} is APPROVED but has no approval metadata`,
          );
          authoritativeApprovedAmendment = false;
        }
        const decisionText = readText(amendment.decisionDocument);
        if (
          decisionText !== undefined &&
          !/(?:Decision status:\s*(?:\*\*)?APPROVED\b|Status:\s*\*\*Accepted\*\*)/i.test(
            decisionText,
          )
        ) {
          errors.push(
            `Scope Amendment ${item.id}/${amendment.id} is APPROVED but its decision document is not approved`,
          );
          authoritativeApprovedAmendment = false;
        } else if (decisionText !== undefined) {
          const approval = parseDecisionApprovalMetadata(decisionText);
          if (!approval) {
            errors.push(
              `Scope Amendment ${item.id}/${amendment.id} decision document has no machine-readable approval metadata`,
            );
            authoritativeApprovedAmendment = false;
          } else if (
            amendment.approvedBy !== approval.approvedBy ||
            amendment.approvedAt !== approval.approvedAt
          ) {
            errors.push(
              `Scope Amendment ${item.id}/${amendment.id} approval metadata does not match its decision document`,
            );
            authoritativeApprovedAmendment = false;
          }
        }
      }
      if (authoritativeApprovedAmendment) approvedAmendments.set(amendment.id, amendment);
      for (const criterionId of amendment.affectedCriteria) {
        if (!criterionIds.has(criterionId)) {
          errors.push(
            `Scope Amendment ${item.id}/${amendment.id} references unknown Criterion: ${criterionId}`,
          );
        }
      }
      const newOwner = canonicalById.get(amendment.newOwner);
      if (!newOwner || newOwner.id === item.id || newOwner.status === 'COMPLETE') {
        errors.push(
          `Scope Amendment ${item.id}/${amendment.id} requires a canonical non-complete new owner: ${amendment.newOwner}`,
        );
      }
    }

    for (const criterion of manifest.mandatoryCriteria) {
      for (const evidencePath of criterion.evidence) {
        if (!pathExists(evidencePath)) {
          errors.push(
            `Criterion evidence does not exist for ${item.id}/${criterion.id}: ${evidencePath}`,
          );
        }
      }
      if (criterion.scopeAmendment) {
        const amendment = amendmentById.get(criterion.scopeAmendment);
        if (!amendment) {
          errors.push(
            `Criterion ${item.id}/${criterion.id} references unknown Scope Amendment: ${criterion.scopeAmendment}`,
          );
        } else if (!approvedAmendments.has(criterion.scopeAmendment)) {
          errors.push(
            `Criterion ${item.id}/${criterion.id} requires an approved Scope Amendment: ${criterion.scopeAmendment}`,
          );
        } else if (!amendment.affectedCriteria.includes(criterion.id)) {
          errors.push(
            `Criterion ${item.id}/${criterion.id} is not listed in Scope Amendment ${criterion.scopeAmendment}`,
          );
        }
      }
      if (
        item.status === 'COMPLETE' &&
        criterion.mandatory &&
        criterion.status !== 'PASS' &&
        (!criterion.scopeAmendment || !approvedAmendments.has(criterion.scopeAmendment))
      ) {
        errors.push(
          `COMPLETE Section ${item.id} has mandatory criterion ${criterion.id} in ${criterion.status}`,
        );
      }
    }

    for (const remaining of manifest.remainingScope) {
      const trackedByWorkItem = canonicalById.has(remaining.trackingId);
      if (!trackedByWorkItem) {
        errors.push(
          `Remaining scope ${item.id}/${remaining.id} has no registered Work Item or governed Backlog ID: ${remaining.trackingId}`,
        );
      }
    }

    for (const excluded of manifest.excludedScope ?? []) {
      const trackedByWorkItem = canonicalById.has(excluded.trackingId);
      if (!trackedByWorkItem) {
        errors.push(
          `Excluded scope ${item.id}/${excluded.id} has no registered Work Item or governed Backlog ID: ${excluded.trackingId}`,
        );
      }
      if (!excluded.scopeAmendment || !approvedAmendments.has(excluded.scopeAmendment)) {
        errors.push(
          `Excluded scope ${item.id}/${excluded.id} requires an approved Scope Amendment: ${excluded.scopeAmendment ?? 'none'}`,
        );
      } else {
        usedAmendments.add(excluded.scopeAmendment);
        const amendment = amendmentById.get(excluded.scopeAmendment);
        if (amendment && !amendment.affectedScopeIds.includes(excluded.id)) {
          errors.push(
            `Excluded scope ${item.id}/${excluded.id} is not listed in Scope Amendment ${excluded.scopeAmendment}`,
          );
        }
        if (amendment && amendment.newOwner !== excluded.trackingId) {
          errors.push(
            `Excluded scope ${item.id}/${excluded.id} tracking owner must match Scope Amendment ${excluded.scopeAmendment} newOwner`,
          );
        }
      }
    }

    for (const criterion of manifest.mandatoryCriteria) {
      if (criterion.scopeAmendment) usedAmendments.add(criterion.scopeAmendment);
    }
    for (const amendment of manifest.scopeAmendments) {
      if (amendment.status === 'APPROVED' && !usedAmendments.has(amendment.id)) {
        errors.push(`Scope Amendment ${item.id}/${amendment.id} is approved but unused`);
      }
    }
    if (item.status === 'COMPLETE' && manifest.remainingScope.length > 0) {
      errors.push(`COMPLETE Section ${item.id} has unresolved remainingScope`);
    }

    if (manifest.evidenceRegistryUpdates.length === 0) {
      errors.push(`Completion status manifest ${item.id} has no Evidence Registry update`);
    }
    for (const evidenceId of manifest.evidenceRegistryUpdates) {
      if (!evidenceById.has(evidenceId)) {
        errors.push(
          `Completion status manifest ${item.id} references missing Evidence Registry ID: ${evidenceId}`,
        );
      }
    }
    if (item.status === 'COMPLETE') {
      if (!manifest.approvedBy)
        errors.push(`COMPLETE manifest ${item.id} has no completion approver`);
      if (!manifest.approvedAt) errors.push(`COMPLETE manifest ${item.id} has no approval date`);
      if (
        manifest.approvedBy !== completionApprovedBy ||
        manifest.approvedAt !== completionApprovedAt
      ) {
        errors.push(`Registry/completion manifest approval metadata drift for ${item.id}`);
      }
    }
  }

  for (const item of registry.items.filter((candidate) => candidate.type === 'INCREMENT')) {
    if (item.status !== 'COMPLETE') continue;
    const completionEvidence = item.completionManifest
      ? evidenceByPath.get(item.completionManifest)
      : undefined;
    const completionApprovedBy = completionEvidence?.approvedBy ?? null;
    const completionApprovedAt = completionEvidence?.approvedAt ?? null;
    validateLegacyCompletionApproval(item, completionEvidence, errors);
    if (!completionApprovedBy)
      errors.push(`COMPLETE Increment ${item.id} has no completion approver`);
    if (!completionApprovedAt) errors.push(`COMPLETE Increment ${item.id} has no approval date`);
    if (!item.completionManifest) {
      errors.push(`COMPLETE Increment ${item.id} has no completion evidence`);
    } else if (!evidencePaths.has(item.completionManifest)) {
      errors.push(
        `COMPLETE Increment ${item.id} completion evidence is not owned by the Evidence Registry: ${item.completionManifest}`,
      );
    }
    const parent = byId.get(item.parent ?? '');
    if (!parent || parent.type !== 'SECTION') {
      errors.push(`COMPLETE Increment ${item.id} has no SECTION parent`);
    } else if (!['COMPLETE', 'IN_PROGRESS'].includes(parent.status)) {
      errors.push(
        `COMPLETE Increment ${item.id} has an invalid parent Section status: ${parent.status}`,
      );
    }
  }

  return errors;
}

export function renderFrontendStatusBlock(
  registry: FrontendWorkItemRegistry,
  manifests: Record<string, FrontendCompletionManifest>,
): string {
  const canonicalItems = registry.items.filter(
    (item) => item.decisionStatus === 'MIGRATED' || item.decisionStatus === 'ACCEPTED',
  );
  const byId = new Map(canonicalItems.map((item) => [item.id, item]));
  const activeSection = canonicalItems.find(
    (item) => item.type === 'SECTION' && item.status === 'IN_PROGRESS',
  );
  const phase = activeSection?.parent
    ? byId.get(activeSection.parent)
    : canonicalItems.find((item) => item.type === 'PHASE' && item.status === 'IN_PROGRESS');
  const section =
    activeSection ??
    canonicalItems.find((item) => item.type === 'SECTION' && item.status !== 'COMPLETE');
  if (!phase || !section) {
    return [
      markerStart,
      '',
      '> Frontend Work Item status is complete; no active Section remains.',
      '',
      markerEnd,
    ].join('\n');
  }
  const increments = canonicalItems.filter(
    (item) => item.type === 'INCREMENT' && item.parent === section.id,
  );
  const nextSection = section.successor ? byId.get(section.successor) : undefined;
  const manifest = manifests[section.id];
  const openCriteria =
    manifest?.mandatoryCriteria
      .filter((criterion) => criterion.mandatory && criterion.status !== 'PASS')
      .map((criterion) => criterion.id)
      .join(', ') ?? 'manifest unavailable';

  const rows = [
    ['Work Item', 'Status'],
    [`${phase.id} — ${phase.title}`, `\`${phase.status}\``],
    [`${section.id} — ${section.title}`, `\`${section.status}\``],
    ...increments.map(
      (increment) =>
        [
          `${increment.id} — ${increment.title}`,
          `\`${increment.status}\`${increment.status === 'COMPLETE' ? ' / VERIFIED' : ''}`,
        ] as [string, string],
    ),
  ];
  const firstColumnWidth = Math.max(...rows.map((row) => row[0]?.length ?? 0));
  const secondColumnWidth = Math.max(...rows.map((row) => row[1]?.length ?? 0));
  const table = [
    `| ${rows[0]?.[0]?.padEnd(firstColumnWidth)} | ${rows[0]?.[1]?.padEnd(secondColumnWidth)} |`,
    `| ${'-'.repeat(firstColumnWidth)} | ${'-'.repeat(secondColumnWidth)} |`,
    ...rows
      .slice(1)
      .map(
        (row) => `| ${row[0]?.padEnd(firstColumnWidth)} | ${row[1]?.padEnd(secondColumnWidth)} |`,
      ),
  ];

  return [
    markerStart,
    '',
    '> 이 블록은 `docs/project/frontend-work-items.json`과 Section Completion Manifest에서 생성됩니다. 블록 내부를 직접 수정하지 않습니다.',
    '',
    ...table,
    '',
    `- 미충족 필수 기준: \`${openCriteria}\``,
    `- Next valid Product Section: \`${nextSection?.id ?? 'NONE'} — ${nextSection?.title ?? 'none'}\``,
    '',
    markerEnd,
  ].join('\n');
}

export function collectProjectionErrors(
  registry: FrontendWorkItemRegistry,
  manifests: Record<string, FrontendCompletionManifest>,
  documents: Record<string, string>,
): string[] {
  const errors: string[] = [];
  const expected = renderFrontendStatusBlock(registry, manifests);
  for (const target of projectionTargets) {
    const text = documents[target];
    if (text === undefined) {
      errors.push(`Missing Frontend status projection target: ${target}`);
      continue;
    }
    const start = text.indexOf(markerStart);
    const end = text.indexOf(markerEnd);
    if (start < 0 || end < 0 || end < start) {
      errors.push(`Missing or malformed Frontend status projection block in ${target}`);
      continue;
    }
    const actual = text.slice(start, end + markerEnd.length).replace(/\r\n/g, '\n');
    if (actual !== expected.replace(/\r\n/g, '\n')) {
      errors.push(`Frontend status projection drift in ${target}`);
    }
  }
  return errors;
}

function readJson<T>(root: string, relativePath: string): T {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8')) as T;
}

function loadManifests(root: string): Record<string, FrontendCompletionManifest> {
  const registry = readJson<FrontendWorkItemRegistry>(root, registryPath);
  const manifests: Record<string, FrontendCompletionManifest> = {};
  for (const item of registry.items) {
    if (!item.completionManifest?.startsWith(`${completionDirectory}/`)) continue;
    manifests[item.id] = readJson<FrontendCompletionManifest>(root, item.completionManifest);
  }
  return manifests;
}

function loadDocuments(root: string, targets: readonly string[]): Record<string, string> {
  return Object.fromEntries(
    targets.map((target) => [target, readFileSync(path.join(root, target), 'utf8')]),
  );
}

function validateManifestSchemas(
  root: string,
  manifests: Record<string, FrontendCompletionManifest>,
): string[] {
  const schema = readJson<Record<string, unknown>>(root, schemaPath);
  const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: false });
  const validate = ajv.compile(schema);
  const errors: string[] = [];
  for (const [workItemId, manifest] of Object.entries(manifests)) {
    if (!validate(manifest)) {
      errors.push(
        `Completion manifest schema failure for ${workItemId}: ${JSON.stringify(validate.errors)}`,
      );
    }
  }
  return errors;
}

function validateRegistrySchema(root: string, registry: FrontendWorkItemRegistry): string[] {
  const schema = readJson<Record<string, unknown>>(root, registrySchemaPath);
  const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: false });
  const validate = ajv.compile(schema);
  return validate(registry)
    ? []
    : [`Frontend Work Item registry schema failure: ${JSON.stringify(validate.errors)}`];
}

function replaceProjectionBlock(text: string, replacement: string, target: string): string {
  const start = text.indexOf(markerStart);
  const end = text.indexOf(markerEnd);
  if (start < 0 || end < 0 || end < start) {
    throw new Error(`Missing or malformed Frontend status projection block in ${target}`);
  }
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const normalizedReplacement = replacement.replace(/\r?\n/g, newline);
  return `${text.slice(0, start)}${normalizedReplacement}${text.slice(end + markerEnd.length)}`;
}

function printResult(label: string, errors: string[]): void {
  if (errors.length > 0) {
    for (const error of errors) console.error(`FAIL: ${error}`);
    throw new Error(`${label} failed with ${errors.length} error(s).`);
  }
  console.log(`PASS: ${label}`);
}

export function runFrontendGovernanceCli(args: string[], root = process.cwd()): void {
  const mode = args[0];
  const write = args.includes('--write');
  const registry = readJson<FrontendWorkItemRegistry>(root, registryPath);
  const manifests = loadManifests(root);
  const pathExists = (relativePath: string): boolean => existsSync(path.join(root, relativePath));
  const readText = (relativePath: string): string | undefined =>
    pathExists(relativePath) ? readFileSync(path.join(root, relativePath), 'utf8') : undefined;

  if (mode === 'work-items') {
    const documents = loadDocuments(root, activeWorkItemDocuments);
    printResult(
      'Frontend Work Item registry schema validation',
      validateRegistrySchema(root, registry),
    );
    printResult(
      'Frontend Work Item registry validation',
      collectWorkItemErrors(registry, documents, pathExists, readText),
    );
    return;
  }

  if (mode === 'completion-invariants') {
    const evidence = readJson<{ records: EvidenceRecord[] }>(root, evidenceRegistryPath);
    printResult(
      'Frontend completion manifest schema validation',
      validateManifestSchemas(root, manifests),
    );
    printResult(
      'Frontend completion invariants',
      collectCompletionInvariantErrors(registry, manifests, evidence.records, pathExists, readText),
    );
    return;
  }

  if (mode === 'projections') {
    const documents = loadDocuments(root, projectionTargets);
    if (write) {
      const projection = renderFrontendStatusBlock(registry, manifests);
      for (const target of projectionTargets) {
        const targetPath = path.join(root, target);
        writeFileSync(
          targetPath,
          replaceProjectionBlock(documents[target] ?? '', projection, target),
          'utf8',
        );
      }
      console.log(
        `PASS: regenerated ${projectionTargets.length} Frontend status projection blocks`,
      );
      return;
    }
    printResult(
      'Frontend status projection drift check',
      collectProjectionErrors(registry, manifests, documents),
    );
    return;
  }

  throw new Error(`Unknown Frontend governance mode: ${String(mode)}`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    runFrontendGovernanceCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
