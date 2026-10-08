import Fastify from 'fastify';
import { setupRoutes } from './routes.js';
import { jobQueue } from '../queue/job-queue.js';
import { config } from 'dotenv';
import { executeJob } from '../playwright/session.js';

config();

const fastify = Fastify({ logger: true });

async function start() {
  await setupRoutes(fastify);
  
  // Conectar a fila ao executor do Playwright
  jobQueue.setExecutor(executeJob);
  
  const port = parseInt(process.env.PORT || '3333', 10);
  try {
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`🚀 Oficina On-Demand Worker HTTP API rodando na porta ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();
