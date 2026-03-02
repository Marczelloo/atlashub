import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

import { config } from '../config/env.js';

// Patterns that indicate sensitive information in error messages
const SENSITIVE_PATTERNS = [
  /sql/i,
  /relation/i,
  /column/i,
  /table/i,
  /database/i,
  /syntax error/i,
  /constraint/i,
  /foreign key/i,
  /primary key/i,
  /unique/i,
  /duplicate/i,
  /insert into/i,
  /select.*from/i,
  /update.*set/i,
  /delete.*from/i,
  /connection/i,
  /timeout/i,
  /pool/i,
  /stack/i,
  /at\s+\w+\.\w+/i,
  /at\s+Object\./i,
  /at\s+Module\./i,
  /\.\w+:\d+:\d+/,
];

function sanitizeErrorMessage(message: string, isProduction: boolean): string {
  if (!isProduction) {
    return message;
  }

  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(message)) {
      return 'Invalid request parameters';
    }
  }

  if (message.length > 200) {
    return message.substring(0, 200) + '...';
  }

  return message;
}

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public error: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }

  toJSON() {
    const result: Record<string, unknown> = {
      error: this.error,
      message: sanitizeErrorMessage(this.message, config.isProduction),
      statusCode: this.statusCode,
    };
    // Only include details in development
    if (this.details && !config.isProduction) {
      result.details = this.details;
    }
    return result;
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, 'BAD_REQUEST', message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(401, 'UNAUTHORIZED', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(403, 'FORBIDDEN', message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(404, 'NOT_FOUND', message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, 'CONFLICT', message);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests') {
    super(429, 'TOO_MANY_REQUESTS', message);
  }
}

export class InternalError extends AppError {
  constructor(message = 'Internal server error') {
    super(500, 'INTERNAL_ERROR', message);
  }
}

export function errorHandler(
  error: FastifyError | AppError | ZodError,
  request: FastifyRequest,
  reply: FastifyReply
) {
  // Log full error internally
  request.log.error({
    error: {
      message: error.message,
      stack: 'stack' in error ? error.stack : undefined,
      statusCode: 'statusCode' in error ? error.statusCode : undefined,
    },
    requestId: request.id,
    path: request.url,
    method: request.method,
  });

  // Handle Zod validation errors
  if (error instanceof ZodError) {
    return reply.status(400).send({
      error: 'VALIDATION_ERROR',
      message: 'Invalid request data',
      statusCode: 400,
      ...(config.isProduction ? {} : { details: error.flatten().fieldErrors }),
    });
  }

  // Handle our custom errors
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send(error.toJSON());
  }

  // Handle Fastify errors
  if ('statusCode' in error && typeof error.statusCode === 'number') {
    const sanitizedMessage = sanitizeErrorMessage(error.message, config.isProduction);
    return reply.status(error.statusCode).send({
      error: error.code || 'ERROR',
      message: sanitizedMessage,
      statusCode: error.statusCode,
    });
  }

  // Unknown errors
  return reply.status(500).send({
    error: 'INTERNAL_ERROR',
    message: config.isProduction ? 'An unexpected error occurred' : error.message,
    statusCode: 500,
  });
}
