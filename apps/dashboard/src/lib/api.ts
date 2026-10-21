"use client";

const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
let csrfToken: string | undefined;

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function getCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken;
  const response = await fetch(`${apiUrl}/auth/csrf`, { credentials: "include" });
  if (!response.ok) throw new ApiError("Unable to start a secure session", response.status);
  const result = (await response.json()) as { csrfToken: string };
  csrfToken = result.csrfToken;
  return csrfToken;
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    headers.set("X-CSRF-Token", await getCsrfToken());
  }
  const send = (requestHeaders: Headers) => fetch(`${apiUrl}${path}`, {
    ...options,
    method,
    headers: requestHeaders,
    credentials: "include",
    cache: "no-store"
  });
  let response = await send(headers);
  if (
    response.status === 401 &&
    path !== "/auth/login" &&
    path !== "/auth/refresh" &&
    path !== "/auth/logout" &&
    path !== "/auth/register"
  ) {
    const refreshHeaders = new Headers({ "X-CSRF-Token": await getCsrfToken() });
    const refreshResponse = await fetch(`${apiUrl}/auth/refresh`, {
      method: "POST",
      headers: refreshHeaders,
      credentials: "include",
      cache: "no-store"
    });
    if (refreshResponse.ok) {
      const refreshed = (await refreshResponse.json()) as { csrfToken: string };
      csrfToken = refreshed.csrfToken;
      const retryHeaders = new Headers(options.headers);
      if (options.body && !retryHeaders.has("Content-Type")) {
        retryHeaders.set("Content-Type", "application/json");
      }
      if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
        retryHeaders.set("X-CSRF-Token", csrfToken);
      }
      response = await send(retryHeaders);
    }
  }
  if (response.status === 403 && !["GET", "HEAD", "OPTIONS"].includes(method)) {
    const failure = await response.clone().json().catch(() => ({})) as {
      error?: { code?: string };
    };
    if (failure.error?.code === "CSRF_INVALID") {
      csrfToken = undefined;
      headers.set("X-CSRF-Token", await getCsrfToken());
      response = await send(headers);
    }
  }
  if (response.status === 204) return undefined as T;
  const result = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
    csrfToken?: string;
  } & T;
  if (!response.ok) {
    if (response.status === 401) csrfToken = undefined;
    throw new ApiError(result.error?.message ?? "Request failed", response.status);
  }
  if (typeof result.csrfToken === "string") csrfToken = result.csrfToken;
  return result;
}

export function clearCsrfToken(): void {
  csrfToken = undefined;
}

export type WorkspaceItem = {
  id: string;
  name: string;
  slug?: string;
  role: "owner" | "admin" | "supervisor" | "agent";
  plan?: string;
};

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  emailVerifiedAt: string | null;
  avatarUrl?: string | null;
};

export type AuthMeResponse = {
  user: AuthUser;
  session: { id: string; expiresAt: string };
  workspaces: { workspace: WorkspaceItem | null; role: WorkspaceItem["role"] }[];
};
