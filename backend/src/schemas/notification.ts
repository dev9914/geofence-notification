import { z } from 'zod';

/**
 * HTTP request contracts for the notification API.
 *
 * `occurredAt` accepts epoch milliseconds or an ISO-8601 timestamp (UTC `Z` or an explicit
 * UTC offset); both are normalised to epoch milliseconds before the service sees them.
 * Whether the instant is recent enough is decided by the service, which owns the max
 * reading age and the injected clock.
 */
const occurredAtSchema = z
  .union([z.number().int(), z.iso.datetime({ offset: true })])
  .transform((value) => (typeof value === 'number' ? value : Date.parse(value)));

/**
 * Notification creation payload.
 *
 * `strictObject` on purpose: a client must not be able to smuggle in an authoritative
 * `distanceMeters`, `radiusMeters` or target coordinate - those are rejected as
 * unrecognised keys instead of being silently ignored.
 */
export const createNotificationBodySchema = z.strictObject({
  eventId: z.uuid(),
  sessionId: z.string().min(1).max(128),
  geofenceId: z.string().min(1).max(128),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMeters: z.number().min(0),
  occurredAt: occurredAtSchema,
});

export type CreateNotificationBody = z.infer<typeof createNotificationBodySchema>;

/** Default and maximum page sizes for the notification history. */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/**
 * Bounded pagination for the notification history.
 *
 * Query values arrive as strings, so they are coerced - and then range-checked, so
 * `limit=0`, `limit=1000`, `limit=abc` and negative offsets are all rejected.
 */
export const listNotificationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
