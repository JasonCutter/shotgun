import type {
  ProjectAIConfiguration,
  ProjectAIConfigurationRepositoryPort,
} from '../../../modules/ai-configuration/src/index.js';

const keyOf = (projectId: string, revision: number): string => `${projectId}:${revision}`;

const copy = (configuration: ProjectAIConfiguration): ProjectAIConfiguration => ({
  ...configuration,
});

export class InMemoryProjectAIConfigurationRepository implements ProjectAIConfigurationRepositoryPort {
  private readonly current = new Map<string, ProjectAIConfiguration>();
  private readonly history = new Map<string, ProjectAIConfiguration>();

  async findCurrent(projectId: string): Promise<ProjectAIConfiguration | undefined> {
    const value = this.current.get(projectId);
    return value ? copy(value) : undefined;
  }

  async findRevision(
    projectId: string,
    revision: number,
  ): Promise<ProjectAIConfiguration | undefined> {
    const value = this.history.get(keyOf(projectId, revision));
    return value ? copy(value) : undefined;
  }

  async saveRevision(input: {
    readonly expectedRevision: number;
    readonly next: ProjectAIConfiguration;
  }): Promise<'CREATED' | 'UPDATED' | 'CONFLICT'> {
    const existing = this.current.get(input.next.projectId);
    if ((existing?.aiConfigurationRevision ?? 0) !== input.expectedRevision) return 'CONFLICT';
    if (input.next.aiConfigurationRevision !== input.expectedRevision + 1) return 'CONFLICT';

    const historyKey = keyOf(input.next.projectId, input.next.aiConfigurationRevision);
    if (this.history.has(historyKey)) return 'CONFLICT';
    this.history.set(historyKey, copy(input.next));
    this.current.set(input.next.projectId, copy(input.next));
    return existing ? 'UPDATED' : 'CREATED';
  }
}
