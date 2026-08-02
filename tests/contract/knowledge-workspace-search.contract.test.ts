import { describe, expect, it } from 'vitest';

import { buildCompiledTruthCommand, runDiscoveryCommand } from '../helpers/stage-10.js';
import { evidenceListQuery } from '../helpers/stage-3.js';
import { decisionCommand } from '../helpers/stage-5.js';
import { createDraft } from '../helpers/stage-6.js';
import { createStage7Harness, workspaceSearchQuery } from '../helpers/stage-7.js';
import { entityCandidate, reviewGroupCommand, stageGroupCommand } from '../helpers/stage-9.js';
import {
  sha256Text,
  type CompiledTruthItem,
  type DerivedInferenceCandidate,
  type DiscoveryRunResult,
  type KnowledgeReviewGroup,
  type SearchKnowledgeWorkspaceResult,
} from '../../packages/contracts/src/index.js';

describe('QX-01 SearchKnowledgeWorkspace Stage 7 handler', () => {
  it('composes all approved authorities through Query boundaries and preserves ranking lineage', async () => {
    const { kernel } = await createStage7Harness();
    const { command, draft, intake } = await createDraft(
      kernel,
      'qx-01-authorities',
      'Milo weighs 5 kg.',
    );
    await kernel.connector.sendCommand(
      decisionCommand(command, draft, 'APPROVE', 'qx-01-canonical-approval', 'Evidence checked.'),
    );
    const evidence = (
      await kernel.connector.query<{ items: readonly { evidenceId: string }[] }>(
        evidenceListQuery(command, intake.sourceVersionId),
      )
    ).result.payload.items[0]!;
    const candidate = entityCandidate(
      'candidate:milo',
      intake.sourceVersionId,
      evidence.evidenceId,
      'Milo',
    );
    const group = (
      await kernel.connector.sendCommand<KnowledgeReviewGroup>(
        stageGroupCommand(command, 'group:milo', intake.sourceVersionId, [candidate]),
      )
    ).result;
    await kernel.connector.sendCommand(reviewGroupCommand(command, group, 'APPROVE'));
    await kernel.connector.sendCommand(buildCompiledTruthCommand(command, 'FULL_REBUILD', 'qx-01'));
    const discovery = await kernel.connector.sendCommand<DiscoveryRunResult>(
      runDiscoveryCommand(command, 'INCREMENTAL', 'qx-01', 100, 10),
    );

    const result = (
      await kernel.connector.query<SearchKnowledgeWorkspaceResult>(
        workspaceSearchQuery(command, { schemaVersion: '1.0.0', query: 'Milo', pageSize: 2 }),
      )
    ).result.payload;

    expect(discovery.result.generated).toHaveLength(1);
    expect(result.readiness).toMatchObject({
      partial: false,
      canonicalSearch: { source: 'CANONICAL_SEARCH', status: 'READY' },
      sourceProjections: [{ source: 'COMPILED_TRUTH', status: 'READY' }],
    });
    expect(result.matches).toHaveLength(2);
    expect(result.matches.map((match) => match.authority)).toEqual([
      'CANONICAL',
      'APPROVED_KNOWLEDGE',
    ]);
    expect(result.matches[0]).toMatchObject({
      rank: 1,
      score: 1,
      matchType: 'SUBSTRING',
      kind: 'CLAIM',
      source: {
        authority: 'CANONICAL',
        canonicalResourceId: expect.any(String),
        canonicalRevisionId: expect.any(String),
        sourceId: expect.any(String),
        sourceVersionId: intake.sourceVersionId,
        commitId: expect.any(String),
        evidenceIds: [expect.any(String)],
      },
      projectionStatus: { source: 'CANONICAL_SEARCH', status: 'READY' },
    });
    expect(result.matches[1]).toMatchObject({
      rank: 2,
      score: 1,
      matchType: 'SUBSTRING',
      source: {
        authority: 'APPROVED_KNOWLEDGE',
        knowledgeGroupId: 'group:milo',
        candidateId: 'candidate:milo',
        sourceVersionId: intake.sourceVersionId,
        evidenceIds: [evidence.evidenceId],
      },
    });
    expect(result.nextCursor).toEqual(expect.any(String));
    expect(result.nextCursor).not.toBe('2');
    const firstCursor = result.nextCursor;
    if (!firstCursor) throw new Error('Expected first workspace cursor.');

    await expect(
      kernel.connector.query(
        workspaceSearchQuery(command, {
          schemaVersion: '1.0.0',
          query: 'different request',
          cursor: firstCursor,
          pageSize: 2,
        }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const nextPage = (
      await kernel.connector.query<SearchKnowledgeWorkspaceResult>(
        workspaceSearchQuery(command, {
          schemaVersion: '1.0.0',
          query: 'Milo',
          cursor: firstCursor,
          pageSize: 2,
        }),
      )
    ).result.payload;
    expect(nextPage.matches.map((match) => match.authority)).toEqual([
      'COMPILED_TRUTH',
      'COMPILED_TRUTH',
    ]);
    expect(nextPage.matches.map((match) => match.rank)).toEqual([3, 4]);
    expect(nextPage.nextCursor).toEqual(expect.any(String));
    expect(nextPage.nextCursor).not.toBe('4');
    const secondCursor = nextPage.nextCursor;
    if (!secondCursor) throw new Error('Expected second workspace cursor.');

    const lastPage = (
      await kernel.connector.query<SearchKnowledgeWorkspaceResult>(
        workspaceSearchQuery(command, {
          schemaVersion: '1.0.0',
          query: 'Milo',
          cursor: secondCursor,
          pageSize: 2,
        }),
      )
    ).result.payload;
    expect(lastPage.matches).toHaveLength(1);
    expect(lastPage.matches[0]).toMatchObject({
      rank: 5,
      authority: 'DERIVED_INFERENCE',
      kind: 'KNOWLEDGE_GAP',
      source: {
        authority: 'DERIVED_INFERENCE',
        inferenceId: expect.stringMatching(/^inference:/),
        sourceProjectionDigest: expect.stringMatching(/^sha256:/),
      },
    });
    expect(lastPage.nextCursor).toBeUndefined();
  });

  it('applies typed authority, resource and projection filters before ranking', async () => {
    const { kernel } = await createStage7Harness();
    const { command, draft, intake } = await createDraft(
      kernel,
      'qx-01-filters',
      'Milo weighs 5 kg.',
    );
    await kernel.connector.sendCommand(
      decisionCommand(command, draft, 'APPROVE', 'qx-01-filter-canonical', 'Evidence checked.'),
    );
    const evidence = (
      await kernel.connector.query<{ items: readonly { evidenceId: string }[] }>(
        evidenceListQuery(command, intake.sourceVersionId),
      )
    ).result.payload.items[0]!;
    const group = (
      await kernel.connector.sendCommand<KnowledgeReviewGroup>(
        stageGroupCommand(command, 'group:filter-milo', intake.sourceVersionId, [
          entityCandidate(
            'candidate:filter-milo',
            intake.sourceVersionId,
            evidence.evidenceId,
            'Milo',
          ),
        ]),
      )
    ).result;
    await kernel.connector.sendCommand(reviewGroupCommand(command, group, 'APPROVE'));
    await kernel.connector.sendCommand(
      buildCompiledTruthCommand(command, 'FULL_REBUILD', 'filter'),
    );

    const result = (
      await kernel.connector.query<SearchKnowledgeWorkspaceResult>(
        workspaceSearchQuery(command, {
          schemaVersion: '1.0.0',
          query: 'Milo',
          resourceId: 'group:filter-milo',
          filters: {
            authorities: ['APPROVED_KNOWLEDGE'],
            projectionStatuses: ['READY'],
          },
        }),
      )
    ).result.payload;

    expect(result.matches).toHaveLength(0);
    expect(result.readiness.partial).toBe(false);
  });

  it('uses decoder-compatible code-point ordering for equal approved matches', async () => {
    const { kernel } = await createStage7Harness();
    const { command, intake } = await createDraft(kernel, 'qx-01-ordering');
    const evidence = (
      await kernel.connector.query<{ items: readonly { evidenceId: string }[] }>(
        evidenceListQuery(command, intake.sourceVersionId),
      )
    ).result.payload.items[0]!;
    const candidateIds = ['candidate:!', 'candidate:A', 'candidate:a'] as const;
    for (const [index, candidateId] of candidateIds.entries()) {
      const group = (
        await kernel.connector.sendCommand<KnowledgeReviewGroup>(
          stageGroupCommand(command, `group:ordering-${index}`, intake.sourceVersionId, [
            entityCandidate(candidateId, intake.sourceVersionId, evidence.evidenceId, 'Milo'),
          ]),
        )
      ).result;
      await kernel.connector.sendCommand(reviewGroupCommand(command, group, 'APPROVE'));
    }

    const result = (
      await kernel.connector.query<SearchKnowledgeWorkspaceResult>(
        workspaceSearchQuery(command, {
          schemaVersion: '1.0.0',
          query: 'Milo',
          filters: { authorities: ['APPROVED_KNOWLEDGE'] },
        }),
      )
    ).result.payload;

    expect(result.matches.map((match) => match.source)).toEqual([
      expect.objectContaining({ candidateId: 'candidate:!' }),
      expect.objectContaining({ candidateId: 'candidate:A' }),
      expect.objectContaining({ candidateId: 'candidate:a' }),
    ]);
  });

  it('rejects Derived Inference correlation outside visible graph nodes and evidence', async () => {
    const { kernel, compiledTruthRepository } = await createStage7Harness();
    const { command, draft, intake } = await createDraft(kernel, 'qx-01-derived-correlation');
    await kernel.connector.sendCommand(
      decisionCommand(command, draft, 'APPROVE', 'qx-01-derived-canonical', 'Checked.'),
    );
    const evidence = (
      await kernel.connector.query<{ items: readonly { evidenceId: string }[] }>(
        evidenceListQuery(command, intake.sourceVersionId),
      )
    ).result.payload.items[0]!;
    const group = (
      await kernel.connector.sendCommand<KnowledgeReviewGroup>(
        stageGroupCommand(command, 'group:derived-correlation', intake.sourceVersionId, [
          entityCandidate(
            'candidate:derived-correlation',
            intake.sourceVersionId,
            evidence.evidenceId,
            'Milo',
          ),
        ]),
      )
    ).result;
    await kernel.connector.sendCommand(reviewGroupCommand(command, group, 'APPROVE'));
    await kernel.connector.sendCommand(
      buildCompiledTruthCommand(command, 'FULL_REBUILD', 'derived-correlation'),
    );
    const projectId = command.projectId;
    if (!projectId) throw new Error('Expected project ID.');
    const projection = await compiledTruthRepository.findProjection(projectId);
    if (!projection || !projection.graph.nodes[0]) throw new Error('Expected compiled graph node.');
    const baseNode = projection.graph.nodes[0];
    const relationOnlyNode: CompiledTruthItem = {
      ...baseNode,
      id: 'relation-only-node',
      type: 'RELATION',
      label: 'Milo relation',
    };
    await compiledTruthRepository.synchronize({
      ...projection,
      items: [...projection.items, relationOnlyNode],
    });
    const makeInference = (
      candidateId: string,
      relatedNodeIds: readonly string[],
      evidenceIds: readonly string[],
      sourceProjectionDigest = projection.logicalDigest,
    ): DerivedInferenceCandidate => ({
      candidateId,
      fingerprint: sha256Text(candidateId),
      status: 'DERIVED_INFERENCE',
      candidateType: 'KNOWLEDGE_GAP',
      question: 'Milo',
      relatedNodeIds,
      evidenceIds,
      sourceProjectionDigest,
      reentryPhase: 'VALIDATION',
      createdAt: projection.projectedAt,
    });
    await compiledTruthRepository.saveInferences(projectId, [
      makeInference('inference:missing-node', ['missing-node'], [evidence.evidenceId]),
      makeInference('inference:relation-only', [relationOnlyNode.id], [evidence.evidenceId]),
      makeInference(
        'inference:digest-mismatch',
        [baseNode.id],
        [evidence.evidenceId],
        `sha256:${'d'.repeat(64)}`,
      ),
      makeInference('inference:invisible-evidence', [baseNode.id], ['evidence:invisible']),
    ]);

    const result = (
      await kernel.connector.query<SearchKnowledgeWorkspaceResult>(
        workspaceSearchQuery(command, { schemaVersion: '1.0.0', query: 'Milo' }),
      )
    ).result.payload;

    expect(result.matches.some((match) => match.authority === 'DERIVED_INFERENCE')).toBe(false);
  });

  it('applies caller sensitivity before ranking and rejects malformed cursors', async () => {
    const { kernel } = await createStage7Harness();
    const { command, draft } = await createDraft(kernel, 'qx-01-negative-filters');
    await kernel.connector.sendCommand(
      decisionCommand(command, draft, 'APPROVE', 'qx-01-negative-approval', 'Checked.'),
    );

    const publicQuery = {
      ...workspaceSearchQuery(command, { schemaVersion: '1.0.0', query: 'Milo' }),
      security: { ...command.security!, sensitivity: 'public' as const },
    };
    const filtered = (await kernel.connector.query<SearchKnowledgeWorkspaceResult>(publicQuery))
      .result.payload;
    expect(filtered.matches).toEqual([]);
    expect(filtered.readiness.canonicalSearch.status).toBe('READY');

    await expect(
      kernel.connector.query(
        workspaceSearchQuery(command, {
          schemaVersion: '1.0.0',
          query: 'Milo',
          cursor: 'not-a-stateless-offset',
        }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      kernel.connector.query(
        workspaceSearchQuery(command, {
          schemaVersion: '1.0.0',
          query: 'Milo',
          cursor: '9007199254740992',
        }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('keeps non-ready Compiled Truth status explicit without hiding Canonical results', async () => {
    const { kernel } = await createStage7Harness();
    const first = await createDraft(kernel, 'qx-01-not-built', 'Milo weighs 5 kg.');
    await kernel.connector.sendCommand(
      decisionCommand(
        first.command,
        first.draft,
        'APPROVE',
        'qx-01-not-built-approval',
        'Checked.',
      ),
    );

    const notBuilt = (
      await kernel.connector.query<SearchKnowledgeWorkspaceResult>(
        workspaceSearchQuery(first.command, { schemaVersion: '1.0.0', query: 'Milo' }),
      )
    ).result.payload;
    expect(notBuilt.readiness).toMatchObject({
      partial: true,
      sourceProjections: [{ source: 'COMPILED_TRUTH', status: 'NOT_BUILT' }],
    });
    expect(notBuilt.matches.map((match) => match.authority)).toEqual(['CANONICAL']);

    await kernel.connector.sendCommand(
      buildCompiledTruthCommand(first.command, 'FULL_REBUILD', 'qx-01-stale'),
    );
    const second = await createDraft(kernel, 'qx-01-stale-new-canonical', 'Milo has a collar.');
    await kernel.connector.sendCommand(
      decisionCommand(second.command, second.draft, 'APPROVE', 'qx-01-stale-approval', 'Checked.'),
    );

    const stale = (
      await kernel.connector.query<SearchKnowledgeWorkspaceResult>(
        workspaceSearchQuery(second.command, { schemaVersion: '1.0.0', query: 'Milo' }),
      )
    ).result.payload;
    expect(stale.readiness).toMatchObject({
      partial: true,
      sourceProjections: [{ source: 'COMPILED_TRUTH', status: 'STALE' }],
    });
    expect(stale.matches.some((match) => match.authority === 'CANONICAL')).toBe(true);
    expect(
      stale.matches
        .filter((match) => match.authority === 'COMPILED_TRUTH')
        .every((match) => match.projectionStatus?.status === 'STALE'),
    ).toBe(true);
  });
});
