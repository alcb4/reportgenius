/**
 * API client for ReportGenius frontend.
 *
 * All requests are routed to NEXT_PUBLIC_API_URL (default: http://localhost:3001).
 * JWT is read from localStorage on each request so token changes take effect
 * immediately without needing a page reload.
 */

const API_BASE = "";
const TOKEN_KEY = "rg_token";

// ── Error type ─────────────────────────────────────────────────────────────────

export class APIError extends Error {
  public readonly code: string;
  public readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "APIError";
    this.code = code;
    this.status = status;
  }
}

// ── Token helpers (safe for SSR — guarded by typeof window) ───────────────────

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

// ── Core fetch wrapper ─────────────────────────────────────────────────────────

export interface ApiFetchOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
}

export async function apiFetch<T>(
  path: string,
  options: ApiFetchOptions = {}
): Promise<T> {
  const token = getToken();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const { body, ...rest } = options;

  const response = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}`;
    let errorCode = "HTTP_ERROR";

    try {
      const errorBody = (await response.json()) as {
        error?: string;
        code?: string;
      };
      if (errorBody.error) errorMessage = errorBody.error;
      if (errorBody.code) errorCode = errorBody.code;
    } catch {
      // Response body was not JSON — use the status text.
      errorMessage = response.statusText || errorMessage;
    }

    throw new APIError(errorMessage, errorCode, response.status);
  }

  // 204 No Content — return empty object cast to T.
  if (response.status === 204) {
    return {} as T;
  }

  return response.json() as Promise<T>;
}
