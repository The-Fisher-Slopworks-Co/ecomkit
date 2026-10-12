import { EcomError } from "@ecomkit/core";

export function errorPayload(error: unknown) {
  if (error instanceof EcomError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    };
  }
  return {
    error: {
      code: "internal",
      message: error instanceof Error ? error.message : String(error),
    },
  };
}
