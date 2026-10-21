import cors from 'cors';
import express, { type Application, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { getDatabaseState } from './db/mongoose.js';
import { createApiRouter } from './routes/index.js';
import {
  createNotificationService,
  type NotificationService,
} from './services/notificationService.js';
import { HttpError } from './utils/errors.js';

/** Maximum accepted JSON request body size. */
export const JSON_BODY_LIMIT = '10kb';

interface ApiErrorBody {
  status: 'error';
  error: {
    code: string;
    message: string;
  };
}

interface ErrorDescription {
  statusCode: number;
  code: string;
  message: string;
  log: boolean;
}

export interface AppOptions {
  /**
   * Overrides the notification service. Tests inject a service backed by an in-memory
   * repository so HTTP behaviour can be verified without connecting to Atlas.
   */
  notificationService?: NotificationService;
}

function errorBody(code: string, message: string): ApiErrorBody {
  return { status: 'error', error: { code, message } };
}

/** body-parser tags its failures with a `type` such as `entity.parse.failed`. */
function isBodyParserError(value: unknown): value is { type: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string' &&
    (value as { type: string }).type.startsWith('entity.')
  );
}

function describeError(value: unknown): ErrorDescription {
  if (value instanceof HttpError) {
    return {
      statusCode: value.statusCode,
      code: value.code,
      message: value.message,
      log: value.statusCode >= 500,
    };
  }

  if (isBodyParserError(value)) {
    return value.type === 'entity.too.large'
      ? {
          statusCode: 413,
          code: 'PAYLOAD_TOO_LARGE',
          message: `Request body exceeds the ${JSON_BODY_LIMIT} limit`,
          log: false,
        }
      : {
          statusCode: 400,
          code: 'INVALID_JSON',
          message: 'Request body is not valid JSON',
          log: false,
        };
  }

  return {
    statusCode: 500,
    code: 'INTERNAL_ERROR',
    message: 'Internal server error',
    log: true,
  };
}

/**
 * Builds the Express application.
 *
 * Creating the app never opens a listener and never opens a database connection:
 * `src/server.ts` connects to Atlas and owns the process lifecycle. Dependencies are
 * injectable so HTTP tests can run against a stub service without any database.
 */
export function createApp(options: AppOptions = {}): Application {
  const app = express();
  const notificationService = options.notificationService ?? createNotificationService();

  app.use(helmet());
  app.use(
    cors({
      origin: env.FRONTEND_URL,
    }),
  );
  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'ok',
      message: 'Geofence API is running',
    });
  });

  // Readiness reports the real Mongoose connection state, so a load balancer can hold
  // traffic back until Atlas is actually reachable.
  app.get('/ready', (_req: Request, res: Response) => {
    const database = getDatabaseState();

    if (database === 'connected') {
      res.status(200).json({
        status: 'ok',
        message: 'Geofence API is ready',
        data: { database },
      });

      return;
    }

    res
      .status(503)
      .json(errorBody('DATABASE_UNAVAILABLE', `Geofence API is not ready: MongoDB Atlas is ${database}`));
  });

  app.use('/api/v1', createApiRouter(notificationService));

  // Unmatched routes answer with the same JSON envelope as every other error.
  app.use((req: Request, res: Response) => {
    res
      .status(404)
      .json(errorBody('NOT_FOUND', `${req.method} ${req.originalUrl} is not a supported route`));
  });

  // Centralized error handler: always JSON, never leaks internals.
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const description = describeError(error);

    if (description.log) {
      console.error('Unhandled request error', error);
    }

    res.status(description.statusCode).json(errorBody(description.code, description.message));
  });

  return app;
}
