import { FastifyRequest, FastifyReply } from 'fastify';
import { config } from 'dotenv';
config();

const API_KEY = process.env.WORKER_API_KEY;

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  const apiKey = request.headers['x-api-key'];
  if (!API_KEY) {
     reply.code(500).send({ error: 'Worker API key not configured in .env' });
     return;
  }
  if (!apiKey || apiKey !== API_KEY) {
    reply.code(401).send({ error: 'Unauthorized. Invalid x-api-key' });
    return;
  }
}
