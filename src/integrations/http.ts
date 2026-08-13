export class IntegrationError extends Error {
  readonly provider: string;
  readonly status?: number;
  readonly retryable: boolean;
  readonly details?: unknown;

  constructor(provider: string, message: string, options: { status?: number; retryable?: boolean; details?: unknown } = {}) {
    super(message);
    this.name = "IntegrationError";
    this.provider = provider;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}

export type HttpClient = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function readJson<T>(response: Response, provider: string): Promise<T> {
  const text = await response.text();
  let body: unknown = undefined;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  if (!response.ok) {
    throw new IntegrationError(provider, `Provider request failed with HTTP ${response.status}`, {
      status: response.status,
      retryable: response.status === 408 || response.status === 429 || response.status >= 500,
      details: body,
    });
  }
  return body as T;
}

export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

export function bearerHeaders(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${token}`, ...extra };
}

export function basicHeaders(secretKey: string, extra: Record<string, string> = {}): Record<string, string> {
  const encoded = typeof btoa === "function" ? btoa(`${secretKey}:`) : Buffer.from(`${secretKey}:`).toString("base64");
  return { Authorization: `Basic ${encoded}`, ...extra };
}

export function idempotencyHeaders(key: string): Record<string, string> {
  return { "Idempotency-Key": key, "X-Request-Id": key };
}
