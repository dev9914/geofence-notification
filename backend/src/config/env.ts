import { z } from 'zod';

/**
 * Validated environment configuration.
 *
 * `MONGODB_URI` is validated here when present, but stays optional in the schema so that
 * import-only and test environments never need a database: `db/mongoose.ts` enforces its
 * presence at startup, where a missing URI must fail the process (never a local fallback).
 * Validation messages never include the offending value, because it may contain credentials.
 */
const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  FRONTEND_URL: z
    .string()
    .min(1)
    .refine(
      (value) => value.startsWith('http://') || value.startsWith('https://'),
      'must start with http:// or https://',
    )
    .default('http://localhost:5173'),
  MONGODB_URI: z
    .string()
    .min(1)
    .refine(
      (value) => value.startsWith('mongodb://') || value.startsWith('mongodb+srv://'),
      'must start with mongodb:// or mongodb+srv://',
    )
    .optional(),
});

export type Environment = z.infer<typeof environmentSchema>;

export function parseEnvironment(source: NodeJS.ProcessEnv = process.env): Environment {
  const result = environmentSchema.safeParse(source);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'environment'} ${issue.message}`)
      .join('; ');

    throw new Error(`Invalid environment configuration: ${details}`);
  }

  return result.data;
}

export const env: Environment = parseEnvironment();
