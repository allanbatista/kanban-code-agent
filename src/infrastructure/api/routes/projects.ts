import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ProjectFileStore } from '../../persistence/project-file-store.js';

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

// --- Route Registration ---

export function registerProjectRoutes(fastify: FastifyInstance, store: ProjectFileStore): void {
  // GET /api/projects — list all projects
  fastify.get('/api/projects', async () => {
    const list = store.listProjects();
    return {
      projects: list,
      total: list.length,
    };
  });

  // POST /api/projects — create project
  fastify.post('/api/projects', async (request, reply) => {
    const body = createProjectBody.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid body', issues: body.error.issues });
    }

    const project = store.createProject({
      name: body.data.name,
      description: body.data.description,
      taskIds: body.data.taskIds,
    });

    reply.status(201);
    return project;
  });

  // GET /api/projects/:id — get project detail
  fastify.get('/api/projects/:id', async (request, reply) => {
    const params = projectParams.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid params', issues: params.error.issues });
    }

    const project = store.getProject(params.data.id);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    return project;
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

    const project = store.updateProject(params.data.id, {
      name: body.data.name,
      description: body.data.description,
      taskIds: body.data.taskIds,
    });

    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    return project;
  });

  // DELETE /api/projects/:id — delete project
  fastify.delete('/api/projects/:id', async (request, reply) => {
    const params = projectParams.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid params', issues: params.error.issues });
    }

    if (!store.deleteProject(params.data.id)) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    reply.status(204).send();
  });
}
