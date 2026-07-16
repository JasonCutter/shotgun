import { createServer } from './server.js';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const server = await createServer();

await server.listen({ host: '0.0.0.0', port });
