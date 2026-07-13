import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Orquestrator } from '../../../application/orquestrator.js';
import type { Agent } from '../../../domain/agent.js';
import type { RuntimeConfig } from '../../../domain/task.js';

// --- Zod Schemas ---

const updateAgentBody = z.object({
  runtimeConfig: z.object({
    model: z.enum(['fast', 'balanced', 'deep']).optional(),
    effort: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']).optional(),
  }).optional(),
  role: z.string().min(1).max(200).optional(),
  systemPrompt: z.string().trim().min(1).max(10_000).optional(),
});

const agentParams = z.object({
  name: z.string().min(1).max(100),
});

// --- Helpers ---

function toAgentResponse(agent: Agent) {
  return {
    name: agent.name,
    role: agent.role,
    systemPrompt: agent.systemPrompt,
    runtimeConfig: agent.runtimeConfig,
    tools: agent.tools,
  };
}

// --- Route Registration ---

export function registerAgentRoutes(
  fastify: FastifyInstance,
  orquestrator: Orquestrator,
): void {
  // GET /api/agents — list all agents
  fastify.get('/api/agents', async () => {
    const agents = [...orquestrator.agents.values()];
    return {
      agents: agents.map(toAgentResponse),
      total: agents.length,
    };
  });

  // GET /api/agents/:name — get agent detail
  fastify.get('/api/agents/:name', async (request, reply) => {
    const params = agentParams.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid params', issues: params.error.issues });
    }

    const agent = orquestrator.agents.get(params.data.name);
    if (!agent) {
      return reply.status(404).send({ error: 'Agent not found' });
    }

    return toAgentResponse(agent);
  });

  // PATCH /api/agents/:name — update agent configuration
  fastify.patch('/api/agents/:name', async (request, reply) => {
    const params = agentParams.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid params', issues: params.error.issues });
    }

    const body = updateAgentBody.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid body', issues: body.error.issues });
    }

    const agent = orquestrator.agents.get(params.data.name);
    if (!agent) {
      return reply.status(404).send({ error: 'Agent not found' });
    }

    if (body.data.runtimeConfig) {
      agent.runtimeConfig = {
        ...(agent.runtimeConfig ?? {}),
        ...body.data.runtimeConfig,
      } as RuntimeConfig;
    }
    if (body.data.role !== undefined) {
      agent.role = body.data.role;
    }
    if (body.data.systemPrompt !== undefined) {
      agent.systemPrompt = body.data.systemPrompt;
    }

    return toAgentResponse(agent);
  });
}
