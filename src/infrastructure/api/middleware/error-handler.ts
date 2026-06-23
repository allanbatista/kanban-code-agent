import type { FastifyRequest, FastifyReply } from 'fastify';
import { ZodError } from 'zod';

const DEV = process.env.NODE_ENV !== 'production';

class AgentOutputInvalidError extends Error {
  constructor(
    message: string,
    public readonly rawOutput: string,
  ) {
    super(message);
    this.name = 'AgentOutputInvalidError';
  }
}

function formatZodIssues(error: ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

export function errorHandler(
  error: Error,
  _request: FastifyRequest,
  reply: FastifyReply,
): void {
  // Zod validation errors → 400
  if (error instanceof ZodError) {
    reply.status(400).send({
      error: 'Validation Error',
      issues: formatZodIssues(error),
    });
    return;
  }

  // Agent output invalid → 422
  if (error instanceof AgentOutputInvalidError) {
    reply.status(422).send({
      error: 'Unprocessable Entity',
      message: error.message,
    });
    return;
  }

  // Fastify validation errors (ajv) → 400
  if ('validation' in error && (error as any).validation) {
    reply.status(400).send({
      error: 'Validation Error',
      message: error.message,
    });
    return;
  }

  // Generic → 500
  const statusCode = (error as any).statusCode ?? 500;
  reply.status(statusCode).send({
    error: 'Internal Server Error',
    message: DEV ? error.message : 'An unexpected error occurred',
    ...(DEV ? { stack: error.stack } : {}),
  });
}
