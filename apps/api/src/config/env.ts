import { isSupportedCountry } from 'libphonenumber-js/max';
import { z } from 'zod';

// Explicit 'true'/'false': z.coerce.boolean() would turn the string "false" into true.
const booleanString = (defaultValue: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(defaultValue)
    .transform((value) => value === 'true');

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
  // How long a lead waits for the dispatcher lock before the request fails with 503.
  DISPATCH_LOCK_TIMEOUT_MS: z.coerce.number().int().min(1).default(3000),
  // Accepted clock difference for webhook timestamps (anti-replay window).
  WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().min(1).default(300),
  SEED_DEMO: booleanString('false'),
  SESSION_TTL_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(8),
  // Secure by default; local http development sets COOKIE_SECURE=false explicitly.
  COOKIE_SECURE: booleanString('true'),
  // Front-end origins allowed to send cookie-authenticated writes (comma separated).
  ALLOWED_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((value) => value.split(',').map((origin) => origin.trim()))
    .pipe(z.array(z.url()).min(1)),
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
