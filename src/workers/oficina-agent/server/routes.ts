import { FastifyInstance } from 'fastify';
import { authenticate } from './auth.js';
import { jobQueue } from '../queue/job-queue.js';
import { JobRequest } from '../types/index.js';

const START_TIME = new Date().toISOString();

export async function setupRoutes(fastify: FastifyInstance) {
  
  fastify.get('/health', async (request, reply) => {
    return {
      status: 'ok',
      worker: 'oficina-agent',
      queue_size: jobQueue.getQueueSize(),
      running_job: jobQueue.getRunningJob(),
      session: 'unknown', // Pode ser refinado futuramente
      started_at: START_TIME
    };
  });

  fastify.post<{ Body: JobRequest }>('/v1/jobs', { preHandler: [authenticate] }, async (request, reply) => {
    const jobRequest = request.body;
    
    // Basic Rate Limit (1 job running + small queue tolerance)
    if (jobQueue.getQueueSize() > 50) {
      return reply.code(429).send({ error: 'Queue full. Rate limit exceeded.' });
    }
    
    const { action } = jobRequest;
    if (!['get_revenue', 'get_os', 'audit_os', 'compare_supabase', 'map_domain', 'map_header', 'map_screens', 'generate_workflows', 'execute_workflow', 'consulta_os_exposicao', 'consulta_cmv_loja', 'consulta_contas_pagar_exposicao', 'consulta_os_semana', 'consulta_os_ultima_loja'].includes(action)) {
      return reply.status(400).send({ error: 'Ação inválida. Permitidas: get_revenue, get_os, audit_os, compare_supabase, map_domain, map_header, map_screens, generate_workflows, execute_workflow, consulta_os_exposicao, consulta_cmv_loja, consulta_contas_pagar_exposicao, consulta_os_semana, consulta_os_ultima_loja' });
    }

    const job = await jobQueue.addJob(jobRequest);
    return reply.code(202).send({ job_id: job.id, status: job.status });
  });

  fastify.get<{ Params: { jobId: string } }>('/v1/jobs/:jobId', { preHandler: [authenticate] }, async (request, reply) => {
    const job = jobQueue.getJob(request.params.jobId);
    if (!job) return reply.code(404).send({ error: 'Job não encontrado' });
    
    return {
      job_id: job.id,
      status: job.status,
      request_id: job.request.request_id,
      result: job.result,
      meta: job.meta,
      evidence: job.evidence,
      error: job.error
    };
  });

  fastify.post<{ Params: { jobId: string } }>('/v1/jobs/:jobId/cancel', { preHandler: [authenticate] }, async (request, reply) => {
    const success = jobQueue.cancelJob(request.params.jobId);
    if (!success) {
      return reply.code(400).send({ error: 'Job não pode ser cancelado (já rodando ou não encontrado)' });
    }
    return { message: 'Job cancelado com sucesso' };
  });
}
