import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

// --- In-Memory Project Store ---

interface Project {
  id: string;
  name: string;
  description: string;
  taskIds: string[];
  createdAt: string;
  updatedAt: string;
}

const projects = new Map<string, Project>();

// --- Zod Schemas ---

const createProjectBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  taskIds: z.array(z.string()).optional(),
});

const updateProjectBody = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  taskIds: z.array(z.string()).optional(),
});

const projectParams = z.object({
  id: z.string().min(1).max(128),
});

// --- Helpers ---

function toProjectResponse(project: Project) {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    taskIds: project.taskIds,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

// --- Route Registration ---

export function registerProjectRoutes(fastify: FastifyInstance): void {
  // GET /api/projects — list all projects
  fastify.get('/api/projects', async () => {
    const list = [...projects.values()];
    return {
      projects: list.map(toProjectResponse),
      total: list.length,
    };
  });

  // POST /api/projects — create project
  fastify.post('/api/projects', async (request, reply) => {
    const body = createProjectBody.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid body', issues: body.error.issues });
    }

    const now = new Date().toISOString();
    const project: Project = {
      id: randomUUID(),
      name: body.data.name,
      description: body.data.description ?? '',
      taskIds: body.data.taskIds ?? [],
      createdAt: now,
      updatedAt: now,
    };

    projects.set(project.id, project);
    reply.status(201);
    return toProjectResponse(project);
  });

  // GET /api/projects/:id — get project detail
  fastify.get('/api/projects/:id', async (request, reply) => {
    const params = projectParams.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid params', issues: params.error.issues });
    }

    const project = projects.get(params.data.id);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    return toProjectResponse(project);
  });

  // PATCH /api/projects/:id — update project
  fastify.patch('/api/projects/:id', async (request, reply) => {
    const params = projectParams.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid params', issues: params.error.issues });
    }

    const body = updateProjectBody.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid body', issues: body.error.issues });
    }

    const project = projects.get(params.data.id);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    if (body.data.name !== undefined) project.name = body.data.name;
    if (body.data.description !== undefined) project.description = body.data.description;
    if (body.data.taskIds !== undefined) project.taskIds = body.data.taskIds;
    project.updatedAt = new Date().toISOString();

    return toProjectResponse(project);
  });

  // DELETE /api/projects/:id — delete project
  fastify.delete('/api/projects/:id', async (request, reply) => {
    const params = projectParams.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid params', issues: params.error.issues });
    }

    if (!projects.has(params.data.id)) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    projects.delete(params.data.id);
    reply.status(204).send();
  });
}
