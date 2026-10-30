import type {
  User,
  Progress,
  RunTicket,
} from "../../packages/contracts/src/api";
let csrf = "";
export async function request<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
): Promise<T> {
  if (method !== "GET" && !csrf) {
    const r = await fetch("/api/v1/auth/csrf", { credentials: "same-origin" });
    if (!r.ok)
      throw Error("Account service unavailable. Local gameplay still works.");
    csrf = (await r.json()).token;
  }
  const response = await fetch(`/api/v1/${path}`, {
    method,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(method === "GET" ? {} : { "X-CSRF-Token": csrf }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (data?.code === "CSRF") csrf = "";
    throw Error(
      typeof data?.message === "string"
        ? data.message
        : "Account service unavailable. Local gameplay still works.",
    );
  }
  if (path === "auth/logout" || (path === "me" && method === "DELETE"))
    csrf = "";
  return data as T;
}
export const api = {
  me: () => request<{ user: User }>("me"),
  login: (email: string, password: string) =>
    request<{ user: User }>("auth/login", { email, password }),
  register: (email: string, password: string, displayName: string) =>
    request<{ user: User }>("auth/register", { email, password, displayName }),
  google: (idToken: string) =>
    request<{ user: User }>("auth/google", { idToken }),
  logout: () => request("auth/logout", {}),
  progress: () => request<{ items: Progress[] }>("progress"),
  run: (puzzleId: string) => request<RunTicket>("runs", { puzzleId }),
};
