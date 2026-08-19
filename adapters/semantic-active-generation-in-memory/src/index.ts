import {
  type PruneGenerationsInput,
  type PruneGenerationsResult,
  type RollbackActiveGenerationInput,
  type SemanticActiveGenerationReaderPort,
  type SemanticActivePointer,
  type SemanticIndexRepositoryPort,
  type SemanticLifecycleRepositoryPort,
  type SemanticProjectionGeneration,
  type SemanticProjectionGenerationStatus,
  type SwitchActiveGenerationInput,
  SemanticEmbeddingError,
} from '../../../packages/contracts/src/index.js';

export class InMemorySemanticLifecycleRepository implements SemanticLifecycleRepositoryPort {
  private readonly pointers = new Map<string, SemanticActivePointer>();

  constructor(private readonly indexRepository?: SemanticIndexRepositoryPort) {}

  async getActivePointer(projectId: string): Promise<SemanticActivePointer | undefined> {
    const pointer = this.pointers.get(projectId);
    return pointer ? { ...pointer } : undefined;
  }

  async switchActiveGeneration(input: SwitchActiveGenerationInput): Promise<SemanticActivePointer> {
    if (this.indexRepository) {
      const gen = await this.indexRepository.getGeneration(
        input.projectId,
        input.targetGenerationId,
      );
      if (!gen) {
        throw new SemanticEmbeddingError({
          code: 'CONFIGURATION_REQUIRED',
          safeMessage: `Target generation '${input.targetGenerationId}' does not exist for project '${input.projectId}'.`,
          operation: 'switch-active-generation',
        });
      }
      if (gen.buildStatus !== 'READY') {
        throw new SemanticEmbeddingError({
          code: 'VALIDATION_FAILURE',
          safeMessage: `Target generation '${input.targetGenerationId}' is in status '${gen.buildStatus}', but only READY generations may be activated.`,
          operation: 'switch-active-generation',
        });
      }
    }

    const current = this.pointers.get(input.projectId);
    if (current) {
      if (
        input.expectedCurrentActiveGenerationId !== undefined &&
        current.activeGenerationId !== input.expectedCurrentActiveGenerationId
      ) {
        throw new SemanticEmbeddingError({
          code: 'CONFLICT',
          safeMessage: `Active generation conflict: expected active '${input.expectedCurrentActiveGenerationId}', found '${current.activeGenerationId}'.`,
          operation: 'switch-active-generation',
        });
      }
      if (
        input.expectedPointerRevision !== undefined &&
        current.pointerRevision !== input.expectedPointerRevision
      ) {
        throw new SemanticEmbeddingError({
          code: 'CONFLICT',
          safeMessage: `Pointer revision conflict: expected revision ${input.expectedPointerRevision}, found ${current.pointerRevision}.`,
          operation: 'switch-active-generation',
        });
      }

      const updated: SemanticActivePointer = {
        projectId: input.projectId,
        activeGenerationId: input.targetGenerationId,
        lastKnownGoodGenerationId: current.activeGenerationId,
        pointerRevision: current.pointerRevision + 1,
        updatedAt: new Date().toISOString(),
      };
      this.pointers.set(input.projectId, updated);
      return { ...updated };
    } else {
      if (input.expectedCurrentActiveGenerationId !== undefined) {
        throw new SemanticEmbeddingError({
          code: 'CONFLICT',
          safeMessage: `Active generation conflict: expected active '${input.expectedCurrentActiveGenerationId}', but no active pointer exists.`,
          operation: 'switch-active-generation',
        });
      }
      if (input.expectedPointerRevision !== undefined && input.expectedPointerRevision !== 1) {
        throw new SemanticEmbeddingError({
          code: 'CONFLICT',
          safeMessage: `Pointer revision conflict: expected initial revision ${input.expectedPointerRevision}, but no active pointer exists.`,
          operation: 'switch-active-generation',
        });
      }

      const created: SemanticActivePointer = {
        projectId: input.projectId,
        activeGenerationId: input.targetGenerationId,
        lastKnownGoodGenerationId: undefined,
        pointerRevision: 1,
        updatedAt: new Date().toISOString(),
      };
      this.pointers.set(input.projectId, created);
      return { ...created };
    }
  }

  async rollbackActiveGeneration(
    input: RollbackActiveGenerationInput,
  ): Promise<SemanticActivePointer> {
    const current = this.pointers.get(input.projectId);
    if (!current || !current.lastKnownGoodGenerationId) {
      throw new SemanticEmbeddingError({
        code: 'CONFIGURATION_REQUIRED',
        safeMessage: `No rollback generation exists for project '${input.projectId}'.`,
        operation: 'rollback-active-generation',
      });
    }

    if (
      input.expectedCurrentActiveGenerationId !== undefined &&
      current.activeGenerationId !== input.expectedCurrentActiveGenerationId
    ) {
      throw new SemanticEmbeddingError({
        code: 'CONFLICT',
        safeMessage: `Active generation conflict during rollback: expected active '${input.expectedCurrentActiveGenerationId}', found '${current.activeGenerationId}'.`,
        operation: 'rollback-active-generation',
      });
    }

    if (this.indexRepository) {
      const targetGen = await this.indexRepository.getGeneration(
        input.projectId,
        current.lastKnownGoodGenerationId,
      );
      if (!targetGen || targetGen.buildStatus !== 'READY') {
        throw new SemanticEmbeddingError({
          code: 'VALIDATION_FAILURE',
          safeMessage: `Rollback target generation '${current.lastKnownGoodGenerationId}' is not in READY status.`,
          operation: 'rollback-active-generation',
        });
      }
    }

    const updated: SemanticActivePointer = {
      projectId: input.projectId,
      activeGenerationId: current.lastKnownGoodGenerationId,
      lastKnownGoodGenerationId: undefined,
      pointerRevision: current.pointerRevision + 1,
      updatedAt: new Date().toISOString(),
    };
    this.pointers.set(input.projectId, updated);
    return { ...updated };
  }

  async updateGenerationStatus(
    projectId: string,
    generationId: string,
    status: SemanticProjectionGenerationStatus,
  ): Promise<void> {
    if (this.indexRepository) {
      await this.indexRepository.updateGenerationStatus(projectId, generationId, status);
    }
  }

  async pruneGenerations(input: PruneGenerationsInput): Promise<PruneGenerationsResult> {
    if (!this.indexRepository) {
      return {
        projectId: input.projectId,
        prunedGenerationIds: [],
        retainedGenerationIds: [],
      };
    }

    const pointer = this.pointers.get(input.projectId);
    const protectedSet = new Set<string>();
    if (pointer) {
      protectedSet.add(pointer.activeGenerationId);
      if (pointer.lastKnownGoodGenerationId) {
        protectedSet.add(pointer.lastKnownGoodGenerationId);
      }
    }

    const allGens = await this.indexRepository.listGenerations(input.projectId);
    for (const gen of allGens) {
      if (gen.buildStatus === 'BUILDING') {
        protectedSet.add(gen.generationId);
      }
    }

    const sortedGens = [...allGens].sort((a, b) =>
      b.createdAt < a.createdAt ? -1 : b.createdAt > a.createdAt ? 1 : 0,
    );

    const retainMaxCount = input.retainMaxCount ?? 2;
    let retainedCount = 0;
    const prunedGenerationIds: string[] = [];
    const retainedGenerationIds: string[] = [];

    for (const gen of sortedGens) {
      if (protectedSet.has(gen.generationId)) {
        retainedGenerationIds.push(gen.generationId);
        retainedCount++;
      } else if (retainedCount < retainMaxCount) {
        retainedGenerationIds.push(gen.generationId);
        retainedCount++;
      } else {
        prunedGenerationIds.push(gen.generationId);
      }
    }

    for (const genId of prunedGenerationIds) {
      await this.indexRepository.deleteItemsByGeneration(input.projectId, genId);
      await this.indexRepository.deleteGeneration(input.projectId, genId);
    }

    return {
      projectId: input.projectId,
      prunedGenerationIds,
      retainedGenerationIds,
    };
  }
}

export class InMemorySemanticActiveGenerationReader implements SemanticActiveGenerationReaderPort {
  private readonly activeGenerations = new Map<string, SemanticProjectionGeneration>();

  constructor(
    initialOrLifecycle?:
      | Record<string, SemanticProjectionGeneration>
      | Map<string, SemanticProjectionGeneration>
      | SemanticLifecycleRepositoryPort,
    private readonly indexRepository?: SemanticIndexRepositoryPort,
  ) {
    if (
      initialOrLifecycle &&
      typeof (initialOrLifecycle as SemanticLifecycleRepositoryPort).getActivePointer === 'function'
    ) {
      this.lifecycleRepository = initialOrLifecycle as SemanticLifecycleRepositoryPort;
    } else if (initialOrLifecycle) {
      const entries =
        initialOrLifecycle instanceof Map
          ? initialOrLifecycle.entries()
          : Object.entries(initialOrLifecycle as Record<string, SemanticProjectionGeneration>);
      for (const [projectId, gen] of entries) {
        this.activeGenerations.set(projectId, { ...gen });
      }
    }
  }

  private readonly lifecycleRepository?: SemanticLifecycleRepositoryPort;

  setActiveGeneration(generation: SemanticProjectionGeneration): void {
    this.activeGenerations.set(generation.projectId, { ...generation });
  }

  clearActiveGeneration(projectId: string): void {
    this.activeGenerations.delete(projectId);
  }

  async getActiveGeneration(projectId: string): Promise<SemanticProjectionGeneration | undefined> {
    if (this.lifecycleRepository && this.indexRepository) {
      const pointer = await this.lifecycleRepository.getActivePointer(projectId);
      if (!pointer) return undefined;
      return this.indexRepository.getGeneration(projectId, pointer.activeGenerationId);
    }
    const gen = this.activeGenerations.get(projectId);
    return gen ? { ...gen } : undefined;
  }
}
