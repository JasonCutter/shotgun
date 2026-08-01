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
  }>;
  evidenceRegistryUpdates: string[];
  approvedAt: string | null;
};

type EvidenceRecord = { id: string; path: string };

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

const workItemReferencePattern = /\bFE-P\d+-S\d+(?:-I\d+)?\b/g;
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
    if (candidate.decisionStatus === 'MIGRATED' && !legacyMigratedWorkItemIds.has(candidate.id)) {
      errors.push(`New Work Item ${candidate.id} cannot use MIGRATED decision status`);
    }
    if (candidate.decisionStatus === 'CANDIDATE' && candidate.status !== 'NOT_STARTED') {
      errors.push(`Candidate Work Item ${candidate.id} must remain NOT_STARTED`);
    }
    if (
      candidate.decisionStatus === 'ACCEPTED' &&
      (!candidate.approvedBy || !candidate.approvedAt)
    ) {
      errors.push(`Accepted Work Item ${candidate.id} requires approver and approval date`);
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
      if (successor && successor.predecessor !== item.id) {
        errors.push(
          `Successor/predecessor mismatch: ${item.id} points to ${item.successor}, but reciprocal predecessor is ${String(successor.predecessor)}`,
        );
      }
    }
  }

  const activeSections = items.filter(
    (item) => item.type === 'SECTION' && item.status === 'IN_PROGRESS',
  );
  if (activeSections.length > 1) {
    errors.push(
      `More than one Frontend Section is IN_PROGRESS: ${activeSections.map((item) => item.id).join(', ')}`,
    );
  }

  const phases = items.filter((item) => item.type === 'PHASE');
  const activePhases = phases.filter((item) => item.status === 'IN_PROGRESS');
  if (activePhases.length > 1) {
    errors.push(
      `More than one Frontend Phase is IN_PROGRESS: ${activePhases.map((item) => item.id).join(', ')}`,
    );
  }
  for (const phase of phases) {
    const children = items.filter((item) => item.type === 'SECTION' && item.parent === phase.id);
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
  for (const section of items.filter((item) => item.type === 'SECTION')) {
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
): string[] {
  const errors: string[] = [];
  const byId = new Map(registry.items.map((item) => [item.id, item]));
  const evidenceById = new Map(evidenceRecords.map((record) => [record.id, record]));
  const evidencePaths = new Set(evidenceRecords.map((record) => record.path));

  for (const item of registry.items.filter((candidate) => candidate.type === 'SECTION')) {
    const manifest = manifests[item.id];

    if (item.status === 'COMPLETE') {
      if (!item.completionManifest) {
        errors.push(`COMPLETE Section ${item.id} has no completion manifest or evidence record`);
      } else if (!evidencePaths.has(item.completionManifest)) {
        errors.push(
          `COMPLETE Section ${item.id} completion status lacks an Evidence Registry update for ${item.completionManifest}`,
        );
      }
      if (!item.approvedAt) errors.push(`COMPLETE Section ${item.id} has no approval date`);
      if (!manifest && !legacyMigratedWorkItemIds.has(item.id)) {
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

    const approvedAmendments = new Set(
      manifest.scopeAmendments
        .filter(
          (amendment) =>
            amendment.status === 'APPROVED' && amendment.approvedAt && amendment.approvedBy,
        )
        .map((amendment) => amendment.id),
    );

    for (const criterion of manifest.mandatoryCriteria) {
      for (const evidencePath of criterion.evidence) {
        if (!pathExists(evidencePath)) {
          errors.push(
            `Criterion evidence does not exist for ${item.id}/${criterion.id}: ${evidencePath}`,
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
      const trackedByWorkItem = byId.has(remaining.trackingId);
      const trackedByBacklog = /^BACKLOG-[A-Z0-9-]+$/.test(remaining.trackingId);
      if (!trackedByWorkItem && !trackedByBacklog) {
        errors.push(
          `Remaining scope ${item.id}/${remaining.id} has no registered Work Item or governed Backlog ID: ${remaining.trackingId}`,
        );
      }
    }

    for (const excluded of manifest.excludedScope ?? []) {
      const trackedByWorkItem = byId.has(excluded.trackingId);
      const trackedByBacklog = /^BACKLOG-[A-Z0-9-]+$/.test(excluded.trackingId);
      if (!trackedByWorkItem && !trackedByBacklog) {
        errors.push(
          `Excluded scope ${item.id}/${excluded.id} has no registered Work Item or governed Backlog ID: ${excluded.trackingId}`,
        );
      }
      if (!excluded.scopeAmendment || !approvedAmendments.has(excluded.scopeAmendment)) {
        errors.push(
          `Excluded scope ${item.id}/${excluded.id} requires an approved Scope Amendment: ${excluded.scopeAmendment ?? 'none'}`,
        );
      }
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
    if (item.status === 'COMPLETE' && !manifest.approvedAt) {
      errors.push(`COMPLETE manifest ${item.id} has no approval date`);
    }
  }

  for (const item of registry.items.filter((candidate) => candidate.type === 'INCREMENT')) {
    if (item.status !== 'COMPLETE') continue;
    if (!item.approvedAt) errors.push(`COMPLETE Increment ${item.id} has no approval date`);
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
  const byId = new Map(registry.items.map((item) => [item.id, item]));
  const activeSection = registry.items.find(
    (item) => item.type === 'SECTION' && item.status === 'IN_PROGRESS',
  );
  const phase = activeSection?.parent
    ? byId.get(activeSection.parent)
    : registry.items.find((item) => item.type === 'PHASE' && item.status === 'IN_PROGRESS');
  const section =
    activeSection ??
    registry.items.find((item) => item.type === 'SECTION' && item.status !== 'COMPLETE');
  if (!phase || !section) {
    return [
      markerStart,
      '',
      '> Frontend Work Item status is complete; no active Section remains.',
      '',
      markerEnd,
    ].join('\n');
  }
  const increments = registry.items.filter(
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

  if (mode === 'work-items') {
    const documents = loadDocuments(root, activeWorkItemDocuments);
    printResult(
      'Frontend Work Item registry schema validation',
      validateRegistrySchema(root, registry),
    );
    printResult(
      'Frontend Work Item registry validation',
      collectWorkItemErrors(registry, documents, pathExists),
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
      collectCompletionInvariantErrors(registry, manifests, evidence.records, pathExists),
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
