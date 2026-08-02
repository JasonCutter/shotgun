import { InMemorySearchProjectionRepository } from '../../adapters/stage7-in-memory/src/index.js';
import { InMemoryCompiledTruthRepository } from '../../adapters/stage10-in-memory/src/index.js';
import { InMemoryKnowledgeModelRepository } from '../../adapters/stage9-in-memory/src/index.js';
import { createCitedAnswerModule } from '../../modules/cited-answer/src/index.js';
import { createCompiledTruthModule } from '../../modules/compiled-truth/src/index.js';
import { createKnowledgeModelModule } from '../../modules/knowledge-model/src/index.js';
import { createProjectionSearchModule } from '../../modules/projection-search/src/index.js';
import { createChildQuery, type MessageTransport } from '../../packages/kernel/src/index.js';
import type { SearchKnowledgeWorkspaceRequest } from '../../packages/contracts/src/index.js';
import { createStage6Harness } from './stage-6.js';
import type { directTextCommand } from './stage-5.js';

type IntakeCommand = ReturnType<typeof directTextCommand>;

export const createStage7Harness = async (
  options: {
    readonly transport?: MessageTransport;
    readonly projectionRepository?: InMemorySearchProjectionRepository;
  } = {},
) => {
  const projectionRepository =
    options.projectionRepository ?? new InMemorySearchProjectionRepository();
  const knowledgeRepository = new InMemoryKnowledgeModelRepository();
  const compiledTruthRepository = new InMemoryCompiledTruthRepository();
  const base = await createStage6Harness({
    transport: options.transport,
    additionalModules: [
      createKnowledgeModelModule(knowledgeRepository),
      createCompiledTruthModule(compiledTruthRepository),
      createProjectionSearchModule(projectionRepository),
      createCitedAnswerModule(),
    ],
  });
  return { ...base, projectionRepository, knowledgeRepository, compiledTruthRepository };
};

export const searchQuery = (command: IntakeCommand, query: string, limit = 10) =>
  createChildQuery(command, {
    messageType: 'SearchCanonicalKnowledge',
    schemaVersion: '1.0.0',
    producerModule: 'stage7-test',
    producerVersion: '1.0.0',
    payload: { query, limit },
  });

export const workspaceSearchQuery = (
  command: IntakeCommand,
  payload: SearchKnowledgeWorkspaceRequest,
) =>
  createChildQuery(command, {
    messageType: 'SearchKnowledgeWorkspace',
    schemaVersion: '1.0.0',
    producerModule: 'stage7-test',
    producerVersion: '1.0.0',
    payload,
  });

export const askQuery = (command: IntakeCommand, question: string, limit = 5) =>
  createChildQuery(command, {
    messageType: 'AskCanonicalKnowledge',
    schemaVersion: '1.0.0',
    producerModule: 'stage7-test',
    producerVersion: '1.0.0',
    payload: { question, limit },
  });

export const readinessQuery = (command: IntakeCommand) =>
  createChildQuery(command, {
    messageType: 'GetProjectionReadiness',
    schemaVersion: '1.0.0',
    producerModule: 'stage7-test',
    producerVersion: '1.0.0',
    payload: {},
  });
