import { getDictionary } from "@/lib/i18n/dictionaries";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/types";

const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:4000";

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSec: number | null;

  constructor(
    status: number,
    code: string,
    message: string,
    retryAfterSec: number | null = null,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfterSec = retryAfterSec;
  }
}

export function formatApiError(err: unknown, locale: Locale = DEFAULT_LOCALE): string {
  const dict = getDictionary(locale);
  if (err instanceof ApiClientError) {
    const mapped = dict.errors[err.code as keyof typeof dict.errors];
    return mapped ?? err.message;
  }
  if (err instanceof Error) return err.message;
  return dict.errors.UNKNOWN;
}

function parseRetryAfterSec(response: Response, errorObj: unknown): number | null {
  const header = response.headers.get("retry-after");
  if (header) {
    const asInt = Number.parseInt(header, 10);
    if (Number.isFinite(asInt) && asInt > 0) return asInt;
  }
  if (
    errorObj &&
    typeof errorObj === "object" &&
    "details" in errorObj &&
    errorObj.details &&
    typeof errorObj.details === "object" &&
    "retryAfterSec" in errorObj.details
  ) {
    const v = (errorObj.details as { retryAfterSec: unknown }).retryAfterSec;
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.ceil(v);
  }
  return null;
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  // Fastify 5 rejects empty bodies when Content-Type is application/json
  // (e.g. POST /auctions/:id/publish with no body).
  if (init?.body !== undefined && init.body !== null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers,
  });

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const errorObj =
      body && typeof body === "object" && "error" in body
        ? body.error
        : null;
    const code =
      errorObj && typeof errorObj === "object" && "code" in errorObj && typeof errorObj.code === "string"
        ? errorObj.code
        : "REQUEST_FAILED";
    const message =
      errorObj && typeof errorObj === "object" && "message" in errorObj && typeof errorObj.message === "string"
        ? errorObj.message
        : "Request failed";
    throw new ApiClientError(
      response.status,
      code,
      message,
      parseRetryAfterSec(response, errorObj),
    );
  }
  return body as T;
}

export { API_URL };
