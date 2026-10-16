import { isSupportedCountry } from 'libphonenumber-js/max';
import { z } from 'zod';

// Explicit 'true'/'false': z.coerce.boolean() would turn the string "false" into true.
const booleanString = (defaultValue: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(defaultValue)
    .transform((value) => value === 'true');

// IANA name check (Intl throws RangeError for unknown zones). Postgres uses the same names.
function isKnownTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return true;
  } catch {
    return false;
  }
}

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
  // Reverse proxies allowed to set X-Forwarded-For (comma-separated IPs/CIDRs). Empty = no
  // proxy is trusted and the socket address is the client IP. Never "trust everyone":
  // any caller could then pick its own IP and dodge the per-IP rate limits.
  TRUST_PROXY: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  // Business timezone: where "today" and the from/to date filters start and end.
  APP_TIMEZONE: z.string().default('America/Sao_Paulo').refine(isKnownTimeZone, 'unknown timezone'),
  // Requests per minute per IP. In-memory store: per API instance (see README).
  RATE_LIMIT_GLOBAL_PER_MIN: z.coerce.number().int().min(1).default(300),
  RATE_LIMIT_LEADS_PER_MIN: z.coerce.number().int().min(1).default(60),
  RATE_LIMIT_WEBHOOK_PER_MIN: z.coerce.number().int().min(1).default(120),
  RATE_LIMIT_LOGIN_PER_MIN: z.coerce.number().int().min(1).default(5),
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
