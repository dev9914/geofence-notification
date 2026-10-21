import mongoose from 'mongoose';
import { env } from '../config/env.js';

/**
 * MongoDB Atlas connection lifecycle.
 *
 * Nothing in this module runs at import time: `src/app.ts` can be imported (in tests, or
 * by tooling) without a database connection. Only `src/server.ts` starts the connection,
 * and only after it succeeds does the HTTP listener start.
 */

/** How long to wait for Atlas to accept a connection before failing startup. */
export const DEFAULT_SERVER_SELECTION_TIMEOUT_MS = 5_000;

/** The connection string is absent or unusable; startup must stop. */
export class DatabaseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseConfigurationError';
  }
}

/** Atlas could not be reached; the message never contains credentials or the full URI. */
export class DatabaseConnectionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DatabaseConnectionError';
  }
}

export type DatabaseState = 'disconnected' | 'connected' | 'connecting' | 'disconnecting' | 'unknown';

/** Mongoose `readyState` values (0-3), plus 99 (`uninitialized`). */
const READY_STATES: Readonly<Record<number, DatabaseState>> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

export function describeDatabaseState(readyState: number): DatabaseState {
  return READY_STATES[readyState] ?? 'unknown';
}

/**
 * Host-only description of a connection string, safe to log.
 *
 * Credentials, the database name and every query parameter are deliberately dropped: the
 * userinfo part of a MongoDB URI contains the password.
 */
export function describeDatabaseTarget(uri: string): string {
  try {
    return new URL(uri).hostname || 'unknown host';
  } catch {
    return 'unknown host';
  }
}

export function getDatabaseState(): DatabaseState {
  return describeDatabaseState(mongoose.connection.readyState);
}

export function isDatabaseConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

/** Set while a connection attempt is in flight so concurrent callers share it. */
let pendingConnection: Promise<void> | null = null;

/**
 * Connects to the MongoDB Atlas cluster described by `MONGODB_URI`.
 *
 * - There is no fallback to a local MongoDB: a missing URI is a startup failure.
 * - Repeated concurrent calls share a single attempt, and calling it while already
 *   connected is a no-op, so no duplicate connections are opened.
 * - `serverSelectionTimeoutMS` bounds the attempt, so a wrong host cannot hang startup.
 */
export async function connectToDatabase(
  uri: string | undefined = env.MONGODB_URI,
  timeoutMs: number = DEFAULT_SERVER_SELECTION_TIMEOUT_MS,
): Promise<void> {
  if (isDatabaseConnected()) {
    return;
  }

  if (pendingConnection) {
    return pendingConnection;
  }

  const target = typeof uri === 'string' ? uri.trim() : '';

  if (target.length === 0) {
    throw new DatabaseConfigurationError(
      'MONGODB_URI is not configured. Set the MongoDB Atlas connection string in backend/.env before starting the server.',
    );
  }

  pendingConnection = mongoose
    .connect(target, {
      serverSelectionTimeoutMS: timeoutMs,
      connectTimeoutMS: timeoutMs,
    })
    .then(() => {
      console.log(`Connected to MongoDB Atlas (${describeDatabaseTarget(target)})`);
    })
    .catch((error: unknown) => {
      // The driver error is attached as the cause for server-side debugging, but the
      // message that reaches the operator/startup log never echoes the URI.
      throw new DatabaseConnectionError(
        `Unable to connect to MongoDB Atlas (host: ${describeDatabaseTarget(target)})`,
        { cause: error },
      );
    })
    .finally(() => {
      pendingConnection = null;
    });

  return pendingConnection;
}

/** Closes the Mongoose connection. Safe to call when nothing is connected. */
export async function disconnectFromDatabase(): Promise<void> {
  if (mongoose.connection.readyState === 0) {
    return;
  }

  await mongoose.disconnect();
}
