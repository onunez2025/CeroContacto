import { C4CError, parseODataError } from "./errors.js";
import { consoleLogger, type Logger } from "./logger.js";
import { defaultRetryOptions, withRetry, type RetryOptions } from "./retry.js";

export interface C4CClientConfig {
  /** Ej: https://my360657.crm.ondemand.com/sap/c4c/odata (sin slash final). */
  baseUrl: string;
  username: string;
  password: string;
  timeoutMs?: number;
  retry?: RetryOptions;
  logger?: Logger;
}

interface ODataCollectionResponse<T> {
  d?: { results?: T[] };
}

interface ODataEntityResponse<T> {
  d?: { results?: T };
}

type HttpMethod = "GET" | "POST" | "PATCH";

/**
 * Interfaz minima que consumen los modulos de dominio (customerResolution,
 * registeredProduct, cuposEngine, ticketCreation). Depender de esta
 * interfaz en vez de la clase concreta permite mockear el acceso a C4C
 * en tests unitarios sin golpear la red.
 */
export interface IC4CODataClient {
  getCollection<T>(path: string): Promise<T[]>;
  postEntity<T>(path: string, body: unknown): Promise<T>;
  patch(path: string, body: unknown): Promise<void>;
}

/**
 * Cliente OData generico para los servicios de C4C usados por
 * CeroContacto (v1/c4codataapi y los BOs custom bajo cust/v1/*).
 *
 * No implementa reintentos automaticos en POST/PATCH: reintentar una
 * creacion ciegamente puede duplicar un cliente o producto registrado en
 * C4C. Los dominios que necesiten reintentar una escritura deben hacerlo
 * de forma explicita despues de re-verificar existencia (patron
 * "GET antes de POST" que ya sigue todo el flujo de negocio).
 */
export class C4CODataClient implements IC4CODataClient {
  private readonly baseUrl: string;
  private readonly username: string;
  private readonly password: string;
  private readonly timeoutMs: number;
  private readonly retryOptions: RetryOptions;
  private readonly logger: Logger;

  constructor(config: C4CClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.username = config.username;
    this.password = config.password;
    this.timeoutMs = config.timeoutMs ?? 15_000;
    this.retryOptions = config.retry ?? defaultRetryOptions;
    this.logger = config.logger ?? consoleLogger;
  }

  /** GET de una coleccion filtrada; devuelve [] si no hay resultados. */
  async getCollection<T>(path: string): Promise<T[]> {
    const res = await this.requestWithRetry("GET", path);
    const json = (await res.json()) as ODataCollectionResponse<T>;
    return json.d?.results ?? [];
  }

  /** POST que crea una entidad; C4C devuelve `d.results` con la entidad creada. */
  async postEntity<T>(path: string, body: unknown): Promise<T> {
    const res = await this.request("POST", path, body);
    const json = (await res.json()) as ODataEntityResponse<T>;
    if (!json.d?.results) {
      throw new C4CError("Respuesta de creacion sin cuerpo d.results", res.status);
    }
    return json.d.results;
  }

  /** PATCH parcial; C4C responde 204 No Content en exito. */
  async patch(path: string, body: unknown): Promise<void> {
    await this.request("PATCH", path, body);
  }

  private async requestWithRetry(method: HttpMethod, path: string, body?: unknown): Promise<Response> {
    return withRetry(
      () => this.request(method, path, body),
      (err) => err instanceof C4CError && err.isTransient,
      this.retryOptions,
    );
  }

  private authHeader(): string {
    const token = Buffer.from(`${this.username}:${this.password}`).toString("base64");
    return `Basic ${token}`;
  }

  private async request(method: HttpMethod, path: string, body?: unknown): Promise<Response> {
    const url = `${this.baseUrl}/${path.replace(/^\/+/, "")}`;
    const started = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url, {
        method,
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          Authorization: this.authHeader(),
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });

      const durationMs = Date.now() - started;
      this.logger.info("c4c_request", { method, path, status: res.status, durationMs });

      if (!res.ok) {
        const err = await parseODataError(res);
        this.logger.warn("c4c_request_failed", {
          method,
          path,
          status: res.status,
          businessMessage: err.businessMessage,
        });
        throw err;
      }

      return res;
    } catch (err) {
      if (err instanceof C4CError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        this.logger.warn("c4c_request_timeout", { method, path, timeoutMs: this.timeoutMs });
        throw new C4CError(`Timeout llamando a C4C: ${method} ${path}`, 504, { isTransient: true });
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }
}
