export interface Env {
  DB: D1Database;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  APP_PASSWORD?: string;
}

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export const badRequest = (m: string) => new HttpError(400, m);
export const notFound = (m = "Not found") => new HttpError(404, m);

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, x-app-password",
  "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
};

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS },
  });
}

export function text(body: string, contentType: string, filename?: string): Response {
  const headers: Record<string, string> = { "content-type": contentType, ...CORS };
  if (filename) headers["content-disposition"] = `attachment; filename="${filename}"`;
  return new Response(body, { headers });
}

export function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export const now = () => new Date().toISOString();

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export async function readBody<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw badRequest("Request body must be valid JSON");
  }
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function round(n: number, places = 2): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** Collapse whitespace so excerpts stay readable in the UI and in prompts. */
export function squash(s: string, max = 320): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
