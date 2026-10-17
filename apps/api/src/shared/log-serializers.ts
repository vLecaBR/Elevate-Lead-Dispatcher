// Error serializer for the logger. Drizzle wraps driver errors in DrizzleQueryError, whose
// message ends with "params: <every bound value>" and which also exposes them as `params`:
// on a failed lead insert that is the person's name, e-mail and phone. Path-based
// redaction cannot catch values inside a message, so the parameters are cut here, while
// the SQL text, SQLSTATE and stack (what a developer needs) are kept.

// From "params:" up to the first stack frame (or the end of the text).
const PARAMS = /\nparams:[\s\S]*?(?=\n\s+at |$)/;

const withoutParams = (text: string) => text.replace(PARAMS, '\nparams: [redacted]');

// A type alias (not an interface) so it fits the logger's Record<string, unknown>.
export type SerializedError = {
  type: string;
  message: string;
  code?: string;
  sqlState?: string;
  constraint?: string;
  // Always present (the logger contract), empty when there is none.
  stack: string;
};

export function serializeError(error: unknown): SerializedError {
  if (!(error instanceof Error)) {
    return { type: 'unknown', message: String(error), stack: '' };
  }
  // The pg error (with SQLSTATE) is the error itself or its cause (Drizzle wrapper).
  const pgError = (error.cause ?? error) as { code?: unknown; constraint?: unknown };
  const code = (error as { code?: unknown }).code;
  return {
    // Class name: some libraries (Drizzle) leave `name` as the generic "Error".
    type: error.constructor.name,
    message: withoutParams(error.message),
    ...(typeof code === 'string' && { code }),
    ...(typeof pgError.code === 'string' && { sqlState: pgError.code }),
    ...(typeof pgError.constraint === 'string' && { constraint: pgError.constraint }),
    stack: withoutParams(error.stack ?? ''),
  };
}
