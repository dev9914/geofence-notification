import { describe, expect, it } from 'vitest';
import {
  DatabaseConfigurationError,
  connectToDatabase,
  describeDatabaseState,
  describeDatabaseTarget,
  disconnectFromDatabase,
  getDatabaseState,
  isDatabaseConnected,
} from './mongoose.js';

/**
 * Connection lifecycle tests.
 *
 * Nothing here reaches the network: a blank URI fails before Mongoose is called, and the
 * sanitisation helper is a pure function. Connecting to a live Atlas cluster is a
 * deployment concern, not a unit-test concern.
 */
describe('describeDatabaseTarget', () => {
  it('reduces a connection string to its host, dropping credentials and options', () => {
    const described = describeDatabaseTarget(
      'mongodb+srv://appuser:sup3r-s3cret@cluster0.example.mongodb.net/geofence?retryWrites=true',
    );

    expect(described).toBe('cluster0.example.mongodb.net');
    expect(described).not.toContain('appuser');
    expect(described).not.toContain('sup3r-s3cret');
    expect(described).not.toContain('geofence');
  });

  it('never throws on an unusable connection string', () => {
    expect(describeDatabaseTarget('not-a-uri')).toBe('unknown host');
    expect(describeDatabaseTarget('')).toBe('unknown host');
  });
});

describe('describeDatabaseState', () => {
  it('maps Mongoose readyState values to names', () => {
    expect(describeDatabaseState(0)).toBe('disconnected');
    expect(describeDatabaseState(1)).toBe('connected');
    expect(describeDatabaseState(2)).toBe('connecting');
    expect(describeDatabaseState(3)).toBe('disconnecting');
    expect(describeDatabaseState(99)).toBe('unknown');
  });
});

describe('connectToDatabase', () => {
  it('starts disconnected and reports that state', async () => {
    await disconnectFromDatabase();

    expect(getDatabaseState()).toBe('disconnected');
    expect(isDatabaseConnected()).toBe(false);
  });

  it('fails without touching the network when MONGODB_URI is missing', async () => {
    await expect(connectToDatabase('')).rejects.toThrow(DatabaseConfigurationError);
    await expect(connectToDatabase('   ')).rejects.toThrow('MONGODB_URI is not configured');
  });

  it('never falls back to a local MongoDB host', async () => {
    let message = '';

    try {
      await connectToDatabase('');
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).not.toContain('localhost');
    expect(message).not.toContain('27017');
  });

  it('leaves the connection closed after a failed configuration attempt', () => {
    expect(isDatabaseConnected()).toBe(false);
  });
});

describe('disconnectFromDatabase', () => {
  it('resolves when nothing is connected', async () => {
    await expect(disconnectFromDatabase()).resolves.toBeUndefined();
    await expect(disconnectFromDatabase()).resolves.toBeUndefined();
  });
});
