import 'dotenv/config';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { connectToDatabase, disconnectFromDatabase } from './db/mongoose.js';

/**
 * Process entry point.
 *
 * The HTTP listener starts only after the MongoDB Atlas connection succeeds, and both the
 * server and the database connection are closed on SIGTERM/SIGINT. Nothing here is
 * imported by tests: `src/app.ts` stays free of listeners and database connections.
 */
async function start(): Promise<void> {
  try {
    // No fallback to a local MongoDB: a missing URI or an unreachable cluster aborts
    // startup. The message is sanitized by `connectToDatabase` (host only, no credentials).
    await connectToDatabase();
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : 'unable to connect to MongoDB Atlas';

    console.error(`Startup aborted: ${reason}`);
    process.exit(1);
  }

  const app = createApp();

  const server = app.listen(env.PORT, () => {
    console.log(`Server running on port ${env.PORT}`);
  });

  function shutdown(signal: NodeJS.Signals): void {
    console.log(`${signal} received, closing HTTP server`);

    server.close(async (error) => {
      if (error) {
        console.error('Failed to close the HTTP server cleanly', error);
        process.exit(1);
      }

      try {
        await disconnectFromDatabase();
      } catch (disconnectError) {
        console.error('Failed to disconnect from MongoDB Atlas cleanly', disconnectError);
        process.exit(1);
      }

      process.exit(0);
    });
  }

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

void start();
