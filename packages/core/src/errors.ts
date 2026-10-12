export type EcomErrorCode =
  | "invalid_input"
  | "unknown_provider"
  | "unsupported"
  | "auth_required"
  | "not_found"
  | "http"
  | "confirmation_required"
  | "limit_exceeded"
  | "busy"
  | "secret_store_unavailable";

export class EcomError extends Error {
  override readonly name = "EcomError";

  constructor(
    readonly code: EcomErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}
