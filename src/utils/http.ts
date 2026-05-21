import { config } from "../config.js";

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly cause?: unknown
  ) {
    super(message);
  }
}

export async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs = config.REQUEST_TIMEOUT_MS
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await operation(controller.signal);
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
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
  }

  throw new ProviderError(`Provider ${provider} failed after ${attempts} attempt(s)`, provider, lastError);
}

export async function fetchJson<T>(provider: string, url: URL, init?: RequestInit): Promise<T> {
  return retry(provider, () =>
    withTimeout(async (signal) => {
      const response = await fetch(url, { ...init, signal, headers: { accept: "application/json", ...init?.headers } });
      if (!response.ok) {
        throw new ProviderError(`${provider} returned ${response.status}`, provider);
      }
      return (await response.json()) as T;
    })
  );
}

export async function fetchText(provider: string, url: URL, init?: RequestInit): Promise<string> {
  return retry(provider, () =>
    withTimeout(async (signal) => {
      const response = await fetch(url, { ...init, signal });
      if (!response.ok) {
        throw new ProviderError(`${provider} returned ${response.status}`, provider);
      }
      return response.text();
    })
  );
}
