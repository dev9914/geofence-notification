/**
 * Application error types.
 *
 * Any error thrown as an `HttpError` is translated into the shared JSON error
 * envelope by the centralized error handler in `src/app.ts`.
 */
export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

/** Rejected input (coordinates, accuracy, timestamps, ...). */
export class ValidationError extends HttpError {
  constructor(message: string, code = 'VALIDATION_ERROR') {
    super(400, code, message);
    this.name = 'ValidationError';
  }
}
