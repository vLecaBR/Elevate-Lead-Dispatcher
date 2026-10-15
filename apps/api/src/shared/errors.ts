// Domain errors carry the HTTP status and a stable machine-readable code. Services throw
// them; the central error handler turns them into the single public error format.
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: ReadonlyArray<{ field: string; issue: string }>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export interface ErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    details?: ReadonlyArray<{ field: string; issue: string }>;
  };
}

export function errorBody(
  code: string,
  message: string,
  details?: ReadonlyArray<{ field: string; issue: string }>,
): ErrorBody {
  return { success: false, error: { code, message, ...(details ? { details } : {}) } };
}
