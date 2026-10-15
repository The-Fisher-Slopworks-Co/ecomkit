import { EcomError } from "./errors.ts";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpClientOptions {
  readonly baseUrl: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly fetch?: Fetch;
}

export interface HttpRequest {
  readonly query?: Readonly<Record<string, string | number | undefined>>;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
  readonly onResponse?: (headers: Headers) => void;
}

export interface HttpClient {
  request<T>(method: string, path: string, init?: HttpRequest): Promise<T>;
  get<T>(path: string, init?: HttpRequest): Promise<T>;
  post<T>(path: string, init?: HttpRequest): Promise<T>;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export function createHttpClient(options: HttpClientOptions): HttpClient {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const base = new URL(options.baseUrl);
  if (!base.pathname.endsWith("/")) base.pathname += "/";

  function resolve(path: string): URL {
    if (/^[a-z][a-z\d+.-]*:|^[\\/]{2}/i.test(path)) {
      throw new EcomError("invalid_input", `Refusing absolute URL ${path}`);
    }
    const url = new URL(path.replace(/^\/+/, ""), base);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
      throw new EcomError("invalid_input", `${path} escapes ${base.href}`);
    }
    return url;
  }

  async function request<T>(
    method: string,
    path: string,
    init: HttpRequest = {},
  ): Promise<T> {
    const url = resolve(path);
    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const headers: Record<string, string> = {
      accept: "application/json",
      ...options.headers,
      ...init.headers,
    };
    let body: string | undefined;
    if (init.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(init.body);
    }

    let response: Response;
    try {
      response = await fetchImpl(url.toString(), {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new EcomError(
        "http",
        `${method} ${url.pathname} failed: ${String(error)}`,
      );
    }

    init.onResponse?.(response.headers);
    const text = await response.text();
    const payload: unknown = text === "" ? undefined : parseJson(text);
    if (!response.ok) {
      const code =
        response.status === 401 || response.status === 403
          ? "auth_required"
          : response.status === 404
            ? "not_found"
            : "http";
      throw new EcomError(
        code,
        `${method} ${url.pathname} returned ${response.status}`,
        { status: response.status, body: payload },
      );
    }
    return payload as T;
  }

  return {
    request,
    get: (path, init) => request("GET", path, init),
    post: (path, init) => request("POST", path, init),
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
