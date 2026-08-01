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
    excludedScope: [
      {
        id: 'answer-execution',
        description: 'Answer execution',
        trackingId: 'FE-P2-S2-I03',
        scopeAmendment: null,
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
    const section = registry.items.find((item) => item.id === 'FE-P2-S2');
    if (section) {
      section.status = 'COMPLETE';
      section.completionManifest = 'narrow-slice-evidence.md';
      section.approvedAt = '2026-08-01';
    }
    const errors = collectCompletionInvariantErrors(registry, {}, evidence, exists);
    expect(errors.join('\n')).toContain('child increment completion is insufficient');
  });

  it('rejects excluded scope without a registered Work Item or governed Backlog ID', () => {
    const manifest = manifestFixture();
    manifest.excludedScope[0]!.trackingId = 'later';
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
});
