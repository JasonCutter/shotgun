import { randomUUID } from 'node:crypto';

import {
  stableJson,
  ShotgunError,
  type EvidenceSpan,
  type TransformationRevision,
} from '../../../packages/contracts/src/index.js';
import type {
  EvidenceCandidate,
  EvidenceRepositoryPort,
} from '../../../modules/evidence/src/index.js';
import type {
  SavedTransformation,
  SaveTransformationInput,
  TransformationRevisionSecurityRecord,
  TransformationRepositoryPort,
} from '../../../modules/transformation/src/index.js';

const transformationKey = (
  projectId: string,
  sourceVersionId: string,
  transformerId: string,
  transformerVersion: string,
) => `${projectId}:${sourceVersionId}:${transformerId}:${transformerVersion}`;

export class InMemoryTransformationRepository implements TransformationRepositoryPort {
  private readonly revisions = new Map<string, TransformationRevision>();
  private readonly attempts: string[] = [];

  async save(input: SaveTransformationInput): Promise<SavedTransformation> {
    const key = transformationKey(
      input.projectId,
      input.sourceVersionId,
      input.transformer.id,
      input.transformer.version,
    );
    const attemptId = randomUUID();
    this.attempts.push(attemptId);
    const existing = this.revisions.get(key);
    if (existing) {
      const matches =
        existing.sourceId === input.sourceId &&
        existing.sourceContentHash === input.sourceContentHash &&
        existing.documentHash === input.output.documentHash &&
        existing.sourceMapHash === input.output.sourceMapHash &&
        stableJson([...existing.accessScope].sort()) ===
          stableJson([...input.accessScope].sort()) &&
        existing.sensitivity === input.sensitivity &&
        stableJson(existing.documentIR) === stableJson(input.output.documentIR) &&
        stableJson(existing.sourceMap) === stableJson(input.output.sourceMap);
      if (!matches) {
        throw new ShotgunError({
          code: 'CONFLICT',
          safeMessage: 'The same SourceVersion and transformer version produced different output.',
          module: 'stage3-in-memory',
          operation: 'save-transformation',
        });
      }
      return { attemptId, revision: existing, reusedRevision: true };
    }

    const revision: TransformationRevision = {
      revisionId: randomUUID(),
      projectId: input.projectId,
      sourceId: input.sourceId,
      sourceVersionId: input.sourceVersionId,
      sourceContentHash: input.sourceContentHash,
      transformer: input.transformer,
      documentIR: input.output.documentIR,
      sourceMap: input.output.sourceMap,
      documentHash: input.output.documentHash,
      sourceMapHash: input.output.sourceMapHash,
      accessScope: [...input.accessScope],
      sensitivity: input.sensitivity,
      createdAt: input.createdAt,
    };
    this.revisions.set(key, revision);
    return { attemptId, revision, reusedRevision: false };
  }

  async findBySourceVersion(
    projectId: string,
    sourceVersionId: string,
    transformerId: string,
    transformerVersion: string,
  ): Promise<TransformationRevision | undefined> {
    return this.revisions.get(
      transformationKey(projectId, sourceVersionId, transformerId, transformerVersion),
    );
  }

  async findTransformationRevisionSecurity(
    projectId: string,
    revisionId: string,
  ): Promise<TransformationRevisionSecurityRecord | undefined> {
    const revision = [...this.revisions.values()].find(
      (candidate) => candidate.projectId === projectId && candidate.revisionId === revisionId,
    );
    if (!revision) return undefined;
    return {
      revisionId: revision.revisionId,
      projectId: revision.projectId,
      sourceId: revision.sourceId,
      sourceVersionId: revision.sourceVersionId,
      sourceContentHash: revision.sourceContentHash,
      accessScope: revision.accessScope,
      sensitivity: revision.sensitivity,
    };
  }

  counts() {
    return {
      attempts: this.attempts.length,
      revisions: this.revisions.size,
    };
  }
}

const evidenceKey = (candidate: EvidenceCandidate) =>
  `${candidate.projectId}:${candidate.revisionId}:${candidate.pointer}`;

export class InMemoryEvidenceRepository implements EvidenceRepositoryPort {
  private readonly evidence = new Map<string, EvidenceSpan>();

  constructor(private readonly evidenceIdFactory: () => string = randomUUID) {}

  async index(candidates: readonly EvidenceCandidate[]) {
    const items: EvidenceSpan[] = [];
    let reusedCount = 0;
    for (const candidate of candidates) {
      const key = evidenceKey(candidate);
      const existing = this.evidence.get(key);
      if (existing) {
        if (
          stableJson({ ...existing, evidenceId: undefined }) !==
          stableJson({ ...candidate, evidenceId: undefined })
        ) {
          throw new ShotgunError({
            code: 'CONFLICT',
            safeMessage: 'An Evidence pointer was reused for different source content.',
            module: 'stage3-in-memory',
            operation: 'index-evidence',
          });
        }
        reusedCount += 1;
        items.push(existing);
        continue;
      }
      const item: EvidenceSpan = {
        evidenceId: this.evidenceIdFactory(),
        ...candidate,
      };
      this.evidence.set(key, item);
      items.push(item);
    }
    return { items, reusedCount };
  }

  async listBySourceVersion(
    projectId: string,
    sourceVersionId: string,
  ): Promise<readonly EvidenceSpan[]> {
    return [...this.evidence.values()]
      .filter((item) => item.projectId === projectId && item.sourceVersionId === sourceVersionId)
      .sort((left, right) => {
        const byStart = left.position.start - right.position.start;
        return byStart === 0 ? left.pointer.localeCompare(right.pointer) : byStart;
      });
  }

  async findById(projectId: string, evidenceId: string): Promise<EvidenceSpan | undefined> {
    return [...this.evidence.values()].find(
      (item) => item.projectId === projectId && item.evidenceId === evidenceId,
    );
  }

  count(): number {
    return this.evidence.size;
  }
}
