export interface LogFields {
  [key: string]: unknown;
}

/**
 * Interfaz minima de logging. En el backend real se implementa sobre
 * Application Insights (contexto de invocation de Azure Functions);
 * en tests/CLI se usa el logger de consola por defecto.
 */
export interface Logger {
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

export const consoleLogger: Logger = {
  info: (message, fields) => console.log(`[c4c-client] ${message}`, fields ?? ""),
  warn: (message, fields) => console.warn(`[c4c-client] ${message}`, fields ?? ""),
  error: (message, fields) => console.error(`[c4c-client] ${message}`, fields ?? ""),
};

export const noopLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};
