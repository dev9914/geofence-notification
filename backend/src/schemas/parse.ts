import { z } from 'zod';
import { ValidationError } from '../utils/errors.js';

/**
 * Parses `input` with `schema`, turning failures into the shared 400 validation error.
 *
 * Field paths are included so a client can fix the request, but no received value is
 * echoed back.
 */
export function parseWithSchema<Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
  subject = 'request body',
): z.infer<Schema> {
  const result = schema.safeParse(input);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => {
        const path = issue.path.join('.');
        return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
      })
      .join('; ');

    throw new ValidationError(`Invalid ${subject}: ${details}`);
  }

  return result.data as z.infer<Schema>;
}
