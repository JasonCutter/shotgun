import type {
  SemanticActiveGenerationReaderPort,
  SemanticProjectionGeneration,
} from '../../../packages/contracts/src/index.js';

export class InMemorySemanticActiveGenerationReader implements SemanticActiveGenerationReaderPort {
  private readonly activeGenerations = new Map<string, SemanticProjectionGeneration>();

  constructor(
    initialActiveMap?:
      Record<string, SemanticProjectionGeneration> | Map<string, SemanticProjectionGeneration>,
  ) {
    if (initialActiveMap) {
      const entries =
        initialActiveMap instanceof Map
          ? initialActiveMap.entries()
          : Object.entries(initialActiveMap);
      for (const [projectId, gen] of entries) {
        this.activeGenerations.set(projectId, { ...gen });
      }
    }
  }

  setActiveGeneration(generation: SemanticProjectionGeneration): void {
    this.activeGenerations.set(generation.projectId, { ...generation });
  }

  clearActiveGeneration(projectId: string): void {
    this.activeGenerations.delete(projectId);
  }

  async getActiveGeneration(projectId: string): Promise<SemanticProjectionGeneration | undefined> {
    const gen = this.activeGenerations.get(projectId);
    return gen ? { ...gen } : undefined;
  }
}
