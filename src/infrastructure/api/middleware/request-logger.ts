import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Logger } from '../../logging/logger.js';

export function requestLogger(logger: Logger) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const start = Date.now();

    _reply.raw.on('finish', () => {
      const duration = Date.now() - start;
      logger.info('request', {
        method: request.method,
        url: request.url,
        statusCode: _reply.statusCode,
        durationMs: duration,
        userAgent: request.headers['user-agent']?.slice(0, 120),
      });
    });
  };
}
