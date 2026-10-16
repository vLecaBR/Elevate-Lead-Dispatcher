import type { FastifyError, FastifyInstance } from 'fastify';
import { AppError, errorBody } from '../shared/errors.js';
import { isPoolExhausted } from '../shared/pg-errors.js';

// Fastify's own request errors (body parsing, size, content type) mapped to public codes.
const fastifyErrorCodes: Record<string, string> = {
  FST_ERR_CTP_INVALID_JSON_BODY: 'invalid_json',
  FST_ERR_CTP_EMPTY_JSON_BODY: 'invalid_json',
  FST_ERR_CTP_BODY_TOO_LARGE: 'payload_too_large',
  FST_ERR_CTP_INVALID_MEDIA_TYPE: 'unsupported_media_type',
};

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    if (error instanceof AppError) {
      if (error.headers) {
        reply.headers(error.headers);
      }
      return reply.code(error.statusCode).send(errorBody(error.code, error.message, error.details));
    }

    const status = error.statusCode ?? 500;
    if (status >= 400 && status < 500) {
      const code = fastifyErrorCodes[error.code] ?? 'bad_request';
      return reply.code(status).send(errorBody(code, error.message));
    }

    // Overload, not a bug: every pooled connection stayed busy for the whole wait. Nothing
    // was written (no connection, no transaction), so the client can safely retry.
    if (isPoolExhausted(error)) {
      request.log.warn('database pool exhausted');
      return reply
        .code(503)
        .header('retry-after', '1')
        .send(errorBody('service_busy', 'Service is busy, retry shortly'));
    }

    // Unexpected: log everything server-side, return nothing that reveals internals
    // (no stack, no SQL, no driver message).
    request.log.error({ err: error }, 'unhandled error');
    return reply.code(500).send(errorBody('internal_error', 'Internal server error'));
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send(errorBody('not_found', 'Route not found')),
  );
}
