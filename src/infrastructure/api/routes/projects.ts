import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Orquestrator } from '../../../application/orquestrator.js';

// --- Zod Schemas ---

const createProjectBody = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/).optional(),
  description: z.string().max(2000).optional(),
  gitUrl: z.string().url().optional(),
  defaultBranch: z.string().min(1).max(128).optional(),
  autoMerge: z.boolean().optional(),
  devcontainerPath: z.string().max(512).optional(),
});

const updateProjectBody = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  gitUrl: z.string().url().optional().or(z.literal('')),
  defaultBranch: z.string().min(1).max(128).optional(),
  autoMerge: z.boolean().optional(),
  devcontainerPath: z.string().max(512).nullable().optional(),
});

const projectParams = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
});

// --- Route Registration ---

export function registerProjectRoutes(fastify: FastifyInstance, orquestrator: Orquestrator): void {
  // GET /api/projects — list all projects
  fastify.get('/api/projects', async () => {
    const list = orquestrator.listProjects();
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

    try {
      const project = orquestrator.createProject({
        name: body.data.name,
        slug: body.data.slug,
        description: body.data.description,
        gitUrl: body.data.gitUrl,
        defaultBranch: body.data.defaultBranch,
        autoMerge: body.data.autoMerge,
        devcontainerPath: body.data.devcontainerPath,
      });

      reply.status(201);
      return project;
    } catch (error) {
      return reply.status(400).send({
        error: 'Failed to create project',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // GET /api/projects/:id — get project detail
  fastify.get('/api/projects/:id', async (request, reply) => {
    const params = projectParams.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid params', issues: params.error.issues });
    }

    const project = orquestrator.getProject(params.data.id);
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

    let project;
    try {
      project = orquestrator.updateProject(params.data.id, {
        name: body.data.name,
        description: body.data.description,
        gitUrl: body.data.gitUrl,
        defaultBranch: body.data.defaultBranch,
        autoMerge: body.data.autoMerge,
        devcontainerPath: body.data.devcontainerPath,
      });
    } catch (error) {
      return reply.status(400).send({
        error: 'Failed to update project',
        message: error instanceof Error ? error.message : String(error),
      });
    }

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

    if (!orquestrator.deleteProject(params.data.id)) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    reply.status(204).send();
  });
}
