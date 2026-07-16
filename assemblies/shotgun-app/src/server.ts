import Fastify from 'fastify';

import { ModuleRegistry } from '../../../packages/kernel/src/index.js';
import { testModule } from '../../../modules/test-module/src/index.js';

export const createServer = async () => {
  const registry = new ModuleRegistry();
  await registry.register(testModule);

  const server = Fastify({ logger: false });

  server.get('/health', async () => ({
    status: 'ok',
    modules: registry.list().map((module) => module.id),
  }));

  return server;
};
