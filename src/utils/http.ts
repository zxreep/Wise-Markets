import { config } from "../config.js";

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly cause?: unknown,
    public readonly status?: number
  ) {
    super(message);
  }
}

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
];

export function randomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function defaultHeaders(extra?: HeadersInit): HeadersInit {
  return {
    "User-Agent": randomUserAgent(),
    Accept: "application/json,text/html,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://finance.yahoo.com/",
    ...(extra ?? {})
  };
}

export async function withTimeout<T>(
  operation: ((signal: AbortSignal) => Promise<T>) | (() => Promise<T>),
  timeoutMs = config.REQUEST_TIMEOUT_MS
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await (operation.length > 0
      ? (operation as (signal: AbortSignal) => Promise<T>)(controller.signal)
      : (operation as () => Promise<T>)());
  } finally {
    clearTimeout(timer);
  }
}

export async function retry<T>(
  provider: string,
  operation: () => Promise<T>,
  attempts = config.PROVIDER_RETRIES + 1
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const status = error instanceof ProviderError ? error.status : undefined;
      const backoff = status === 429 ? 1000 * (attempt + 1) : 250 * (attempt + 1);
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
  }

  throw new ProviderError(`Provider ${provider} failed after ${attempts} attempt(s)`, provider, lastError);
}

async function handleNonOk(provider: string, response: Response): Promise<never> {
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("Retry-After") ?? "");
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 60_000) : 0;
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    throw new ProviderError(`${provider} rate limited (429)`, provider, undefined, 429);
  }
  throw new ProviderError(`${provider} returned ${response.status}`, provider, undefined, response.status);
}

export async function fetchJson<T>(provider: string, url: URL, init?: RequestInit): Promise<T> {
  return retry(provider, () =>
    withTimeout(async (signal) => {
      const response = await fetch(url, { ...init, signal, headers: defaultHeaders(init?.headers) });
      if (!response.ok) {
        await handleNonOk(provider, response);
      }
      return (await response.json()) as T;
    })
  );
}

export async function fetchText(provider: string, url: URL, init?: RequestInit): Promise<string> {
  return retry(provider, () =>
    withTimeout(async (signal) => {
      const response = await fetch(url, { ...init, signal, headers: defaultHeaders(init?.headers) });
      if (!response.ok) {
        await handleNonOk(provider, response);
      }
      return response.text();
    })
  );
}
