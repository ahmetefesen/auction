const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:4000";

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
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
    throw new ApiClientError(response.status, code, message);
  }
  return body as T;
}

export { API_URL };
