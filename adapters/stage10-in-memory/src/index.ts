import type {
  CompiledTruthProjection,
  DerivedInferenceCandidate,
} from '../../../packages/contracts/src/index.js';
import type { CompiledTruthRepositoryPort } from '../../../modules/compiled-truth/src/index.js';

const clone = <T>(value: T): T => structuredClone(value);

export class InMemoryCompiledTruthRepository implements CompiledTruthRepositoryPort {
  private readonly projections = new Map<string, CompiledTruthProjection>();
  private readonly degraded = new Map<string, { error: string; updatedAt: string }>();
  private readonly inferences = new Map<string, Map<string, DerivedInferenceCandidate>>();

  async synchronize(projection: CompiledTruthProjection): Promise<CompiledTruthProjection> {
    this.projections.set(projection.projectId, clone(projection));
    this.degraded.delete(projection.projectId);
    return clone(projection);
  }

  async findProjection(projectId: string): Promise<CompiledTruthProjection | undefined> {
    const value = this.projections.get(projectId);
    return value ? clone(value) : undefined;
  }

  async markDegraded(projectId: string, error: string, updatedAt: string): Promise<void> {
    this.degraded.set(projectId, { error, updatedAt });
  }

  async degradedState(
    projectId: string,
  ): Promise<{ error: string; updatedAt: string } | undefined> {
    const value = this.degraded.get(projectId);
    return value ? clone(value) : undefined;
  }

  async saveInferences(
    projectId: string,
    candidates: readonly DerivedInferenceCandidate[],
  ): Promise<{
    accepted: readonly DerivedInferenceCandidate[];
    suppressedFingerprints: readonly string[];
  }> {
    const stored = this.inferences.get(projectId) ?? new Map<string, DerivedInferenceCandidate>();
    const accepted: DerivedInferenceCandidate[] = [];
    const suppressedFingerprints: string[] = [];
    for (const candidate of candidates) {
      if (stored.has(candidate.fingerprint)) {
        suppressedFingerprints.push(candidate.fingerprint);
      } else {
        stored.set(candidate.fingerprint, clone(candidate));
        accepted.push(clone(candidate));
      }
    }
    this.inferences.set(projectId, stored);
    return { accepted, suppressedFingerprints };
  }

  async listInferences(projectId: string): Promise<readonly DerivedInferenceCandidate[]> {
    return [...(this.inferences.get(projectId)?.values() ?? [])]
      .sort((left, right) => left.candidateId.localeCompare(right.candidateId))
      .map(clone);
  }
}
