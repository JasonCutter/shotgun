import { describe, expect, it } from 'vitest';

import {
  collectCompletionInvariantErrors,
  collectProjectionErrors,
  collectWorkItemErrors,
  renderFrontendStatusBlock,
  type FrontendCompletionManifest,
  type FrontendWorkItemRegistry,
} from '../../scripts/frontend-work-item-governance.js';

function registryFixture(): FrontendWorkItemRegistry {
  const common = {
    governingContract: 'contract.md',
    completionManifest: null,
    approvedAt: null,
    supersedes: null,
    introducedByDecision: 'migration',
    decisionStatus: 'MIGRATED' as const,
    approvedBy: null,
  };
  return {
    schemaVersion: 1,
    governingAdr: 'ADR-124',
    statusAuthority: 'registry.json',
    items: [
      {
        ...common,
        id: 'FE-P2',
        type: 'PHASE',
        title: 'Knowledge Input and Question',
        parent: null,
        predecessor: null,
        successor: null,
        status: 'IN_PROGRESS',
      },
      {
        ...common,
        id: 'FE-P2-S1',
        type: 'SECTION',
        title: 'Sources Workspace',
        parent: 'FE-P2',
        predecessor: null,
        successor: 'FE-P2-S2',
        status: 'COMPLETE',
        completionManifest: 's1-evidence.md',
        approvedAt: '2026-07-30',
      },
      {
        ...common,
        id: 'FE-P2-S2',
        type: 'SECTION',
        title: 'Ask and Conversations Workspace',
        parent: 'FE-P2',
        predecessor: 'FE-P2-S1',
        successor: 'FE-P3-S1',
        status: 'IN_PROGRESS',
        completionManifest: 'docs/project/completions/FE-P2-S2.json',
      },
      {
        ...common,
        id: 'FE-P2-S2-I01',
        type: 'INCREMENT',
        title: 'Read Foundation',
        parent: 'FE-P2-S2',
        predecessor: null,
        successor: 'FE-P2-S2-I02',
        status: 'COMPLETE',
      },
      {
        ...common,
        id: 'FE-P2-S2-I02',
        type: 'INCREMENT',
        title: 'Command and Persistence',
        parent: 'FE-P2-S2',
        predecessor: 'FE-P2-S2-I01',
        successor: 'FE-P2-S2-I03',
        status: 'COMPLETE',
      },
      {
        ...common,
        id: 'FE-P2-S2-I03',
        type: 'INCREMENT',
        title: 'Answer Execution',
        parent: 'FE-P2-S2',
        predecessor: 'FE-P2-S2-I02',
        successor: null,
        status: 'NOT_STARTED',
      },
      {
        ...common,
        id: 'FE-P3',
        type: 'PHASE',
        title: 'Knowledge Understanding and Editing',
        parent: null,
        predecessor: null,
        successor: null,
        status: 'NOT_STARTED',
      },
      {
        ...common,
        id: 'FE-P3-S1',
        type: 'SECTION',
        title: 'Knowledge Workspace',
        parent: 'FE-P3',
        predecessor: 'FE-P2-S2',
        successor: null,
        status: 'NOT_STARTED',
      },
    ],
  };
}

function manifestFixture(): FrontendCompletionManifest {
  return {
    schemaVersion: 1,
    workItemId: 'FE-P2-S2',
    status: 'IN_PROGRESS',
    governingContract: 'contract.md',
    mandatoryCriteria: [
      {
        id: 'readFoundation',
        title: 'Read Foundation',
        mandatory: true,
        status: 'PASS',
        evidence: ['read.md'],
        scopeAmendment: null,
      },
      {
        id: 'answerExecution',
        title: 'Answer Execution',
        mandatory: true,
        status: 'NOT_RUN',
        evidence: [],
        scopeAmendment: null,
      },
    ],
    remainingScope: [
      {
        id: 'answer-execution',
        description: 'Answer execution',
        trackingId: 'FE-P2-S2-I03',
      },
    ],
    scopeAmendments: [],
    evidenceRegistryUpdates: ['RECONCILIATION'],
    approvedAt: null,
  };
}

const evidence = [
  { id: 'S1', path: 's1-evidence.md' },
  { id: 'RECONCILIATION', path: 'reconciliation.md' },
];
const exists = () => true;

describe('Frontend Work Item governance', () => {
  it('rejects an unregistered Work Item reference', () => {
    const errors = collectWorkItemErrors(
      registryFixture(),
      { 'plan.md': 'Start FE-P9-S9.' },
      exists,
    );
    expect(errors).toContain('Unregistered Frontend Work Item reference in plan.md: FE-P9-S9');
  });

  it('rejects the invalid active Phase 2 Section 3 path', () => {
    const errors = collectWorkItemErrors(
      registryFixture(),
      { 'plan.md': 'Frontend Phase 2 Section 3 is next.' },
      exists,
    );
    expect(errors).toContain('Invalid active Phase 2 Section reference in plan.md');
  });

  it('rejects mismatched predecessor and successor links', () => {
    const registry = registryFixture();
    const section = registry.items.find((item) => item.id === 'FE-P3-S1');
    if (section) section.predecessor = null;
    expect(collectWorkItemErrors(registry, {}, exists).join('\n')).toContain(
      'Successor/predecessor mismatch',
    );
  });

  it('rejects more than one Section in progress', () => {
    const registry = registryFixture();
    const section = registry.items.find((item) => item.id === 'FE-P3-S1');
    if (section) section.status = 'IN_PROGRESS';
    expect(collectWorkItemErrors(registry, {}, exists).join('\n')).toContain(
      'More than one Frontend Section is IN_PROGRESS',
    );
  });

  it('rejects COMPLETE while a mandatory criterion is NOT_RUN', () => {
    const registry = registryFixture();
    const section = registry.items.find((item) => item.id === 'FE-P2-S2');
    if (section) {
      section.status = 'COMPLETE';
      section.approvedAt = '2026-08-01';
    }
    const manifest = manifestFixture();
    manifest.status = 'COMPLETE';
    manifest.approvedAt = '2026-08-01';
    const errors = collectCompletionInvariantErrors(
      registry,
      { 'FE-P2-S2': manifest },
      evidence,
      exists,
    );
    expect(errors.join('\n')).toContain('mandatory criterion answerExecution in NOT_RUN');
  });

  it('does not allow completed child increments alone to complete a parent Section', () => {
    const registry = registryFixture();
    registry.items.push({
      ...registry.items.find((item) => item.id === 'FE-P2-S2')!,
      id: 'FE-P2-S3',
      title: 'Unapproved Section',
      status: 'COMPLETE',
      completionManifest: 'narrow-slice-evidence.md',
      approvedAt: '2026-08-01',
    });
    const errors = collectCompletionInvariantErrors(registry, {}, evidence, exists);
    expect(errors.join('\n')).toContain('legacy evidence is not allowed for new Sections');
  });

  it('rejects excluded scope without a registered Work Item or governed Backlog ID', () => {
    const manifest = manifestFixture();
    manifest.remainingScope[0]!.trackingId = 'later';
    const errors = collectCompletionInvariantErrors(
      registryFixture(),
      { 'FE-P2-S2': manifest },
      evidence,
      exists,
    );
    expect(errors.join('\n')).toContain('has no registered Work Item or governed Backlog ID');
  });

  it('rejects status drift between the registry and completion manifest', () => {
    const manifest = manifestFixture();
    manifest.status = 'BLOCKED';
    const errors = collectCompletionInvariantErrors(
      registryFixture(),
      { 'FE-P2-S2': manifest },
      evidence,
      exists,
    );
    expect(errors.join('\n')).toContain('Registry/completion manifest status drift');
  });

  it('rejects completion status without an Evidence Registry update', () => {
    const manifest = manifestFixture();
    manifest.evidenceRegistryUpdates = [];
    const errors = collectCompletionInvariantErrors(
      registryFixture(),
      { 'FE-P2-S2': manifest },
      evidence,
      exists,
    );
    expect(errors).toContain('Completion status manifest FE-P2-S2 has no Evidence Registry update');
  });

  it('rejects generated projection drift', () => {
    const registry = registryFixture();
    const manifests = { 'FE-P2-S2': manifestFixture() };
    const block = renderFrontendStatusBlock(registry, manifests);
    const documents = Object.fromEntries(
      [
        'docs/architecture/frontend/README.md',
        'docs/architecture/frontend/phase-2-knowledge-input-question.md',
        'docs/implementation/frontend-phase-1-5-plan-v1.0.md',
        'docs/architecture/add/README.md',
      ].map((target, index) => [target, index === 0 ? `${block}\nmanual drift` : block]),
    );
    documents['docs/architecture/frontend/README.md'] = documents[
      'docs/architecture/frontend/README.md'
    ]!.replace('`IN_PROGRESS`', '`COMPLETE`');
    expect(collectProjectionErrors(registry, manifests, documents).join('\n')).toContain(
      'Frontend status projection drift',
    );
  });

  it('renders the active phase, section and increments from the registry', () => {
    const registry = registryFixture();
    const block = renderFrontendStatusBlock(registry, { 'FE-P2-S2': manifestFixture() });
    expect(block).toContain('FE-P2 — Knowledge Input and Question');
    expect(block).toContain('FE-P2-S2 — Ask and Conversations Workspace');
    expect(block).toContain('FE-P2-S2-I03 — Answer Execution');
    expect(block).not.toContain('Frontend Phase 2 —');
  });

  it('rejects a phase status that contradicts its child sections', () => {
    const registry = registryFixture();
    const phase = registry.items.find((item) => item.id === 'FE-P2');
    if (phase) phase.status = 'COMPLETE';
    expect(collectWorkItemErrors(registry, {}, exists).join('\n')).toContain(
      'cannot be COMPLETE while a child Section is incomplete',
    );
  });

  it('rejects a new migrated Work Item without an accepted decision', () => {
    const registry = registryFixture();
    registry.items.push({
      ...registry.items[0]!,
      id: 'FE-P2-S3',
      type: 'SECTION',
      title: 'Unapproved Section',
      parent: 'FE-P2',
      predecessor: 'FE-P2-S2',
      successor: null,
      status: 'NOT_STARTED',
    });
    expect(collectWorkItemErrors(registry, {}, exists).join('\n')).toContain(
      'cannot use MIGRATED decision status',
    );
  });

  it('rejects excluded scope without an approved amendment', () => {
    const manifest = manifestFixture();
    manifest.excludedScope = [
      {
        id: 'deferred',
        description: 'Deferred scope',
        trackingId: 'FE-P2-S2-I03',
        scopeAmendment: 'AMEND-1',
      },
    ];
    const errors = collectCompletionInvariantErrors(
      registryFixture(),
      { 'FE-P2-S2': manifest },
      evidence,
      exists,
    );
    expect(errors.join('\n')).toContain('requires an approved Scope Amendment');
  });

  it('requires completion evidence and approval for complete increments', () => {
    const registry = registryFixture();
    const increment = registry.items.find((item) => item.id === 'FE-P2-S2-I01');
    if (increment) {
      increment.status = 'COMPLETE';
      increment.approvedAt = null;
      increment.completionManifest = null;
    }
    const errors = collectCompletionInvariantErrors(registry, {}, evidence, exists);
    expect(errors.join('\n')).toContain('COMPLETE Increment FE-P2-S2-I01 has no approval date');
    expect(errors.join('\n')).toContain(
      'COMPLETE Increment FE-P2-S2-I01 has no completion evidence',
    );
  });
});
