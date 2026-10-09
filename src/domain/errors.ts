export type ErrorCategory =
  | "bad_request"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "unprocessable";

export interface FieldError {
  field: string;
  message: string;
}

export class AppError extends Error {
  constructor(
    readonly category: ErrorCategory,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const validationFailed = (fields: FieldError[]) =>
  new AppError("unprocessable", "validation_failed", "Dados inválidos.", { fields });
