export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const defaultRetryOptions: RetryOptions = {
  maxAttempts: 3,
  baseDelayMs: 200,
  maxDelayMs: 2000,
};

function backoffDelay(attempt: number, opts: RetryOptions): number {
  const exp = Math.min(opts.maxDelayMs, opts.baseDelayMs * 2 ** attempt);
  const jitter = Math.random() * exp * 0.25;
  return exp + jitter;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Reintenta `fn` solo cuando `isRetryable` confirma que el error es
 * transitorio (5xx/timeout). Nunca se debe usar para escrituras (POST/PATCH)
 * salvo que la operacion sea idempotente por diseno, porque un reintento
 * ciego de un POST de creacion puede duplicar clientes/productos en C4C.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  isRetryable: (err: unknown) => boolean,
  opts: RetryOptions = defaultRetryOptions,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isRetryable(err) || attempt === opts.maxAttempts - 1) {
        throw err;
      }
      await sleep(backoffDelay(attempt, opts));
    }
  }
  throw lastError;
}
