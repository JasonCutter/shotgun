import type {
  SemanticActiveGenerationReaderPort,
  SemanticProjectionGeneration,
} from '../../../packages/contracts/src/index.js';

export class InMemorySemanticActiveGenerationReader implements SemanticActiveGenerationReaderPort {
  private readonly activeGenerations = new Map<string, SemanticProjectionGeneration>();

  constructor(initialGenerations: readonly SemanticProjectionGeneration[] = []) {
    for (const gen of initialGenerations) {
      if (gen.buildStatus === 'READY') {
        this.activeGenerations.set(gen.projectId, gen);
      }
    }
  }

  setActiveGeneration(generation: SemanticProjectionGeneration): void {
    if (generation.buildStatus === 'READY') {
      this.activeGenerations.set(generation.projectId, generation);
    } else {
      this.activeGenerations.delete(generation.projectId);
    }
  }

  clearActiveGeneration(projectId: string): void {
    this.activeGenerations.delete(projectId);
  }

  async getActiveGeneration(projectId: string): Promise<SemanticProjectionGeneration | undefined> {
    const gen = this.activeGenerations.get(projectId);
    return gen ? { ...gen } : undefined;
  }
}
