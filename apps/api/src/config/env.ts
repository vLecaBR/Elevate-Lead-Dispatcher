import { isSupportedCountry } from 'libphonenumber-js/max';
import { z } from 'zod';

// Only variables used by the code today. Each phase adds the ones it needs.
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().min(1).default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // Region used for phone numbers sent without "+<country code>".
  DEFAULT_PHONE_REGION: z
    .string()
    .default('BR')
    .refine(isSupportedCountry, 'unsupported phone region'),
  // Explicit 'true'/'false': z.coerce.boolean() would turn the string "false" into true.
  SEED_DEMO: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    // Fail fast at startup with every problem listed, instead of crashing later on first use.
    throw new Error(`Invalid environment variables:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
