import type { ZodError } from "zod";

export type FormattedZodError = {
  code: "VALIDATION_ERROR";
  message: string;
  details: Array<{
    path: string;
    message: string;
  }>;
};

/** Map a ZodError into a stable API error payload. */
export function formatZodError(error: ZodError): FormattedZodError {
  const details = error.issues.map((issue) => ({
    path: issue.path.map(String).join(".") || "(root)",
    message: issue.message,
  }));

  const first = details[0];
  const message = first
    ? `Validation failed: ${first.path} — ${first.message}`
    : "Validation failed";

  return {
    code: "VALIDATION_ERROR",
    message,
    details,
  };
}
