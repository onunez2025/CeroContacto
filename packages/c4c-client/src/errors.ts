/**
 * SAP C4C no ofrece logging de errores propio (ver seccion 6 del
 * documento tecnico del proveedor): el middleware es responsable de
 * interpretar el HTTP status y el cuerpo OData de error.
 *
 * - 200/201: exito.
 * - 400: JSON invalido, datos maestros faltantes, o una regla de negocio
 *   ABSL fallida (ej. "Cupos agotados para los valores seleccionados").
 *   El mensaje viene en error.message.value y debe mostrarse al usuario.
 * - 401/403: fallo de autenticacion o falta de permisos de _SYSODATA.
 * - 5xx / timeout: transitorio, reintentable - EXCEPTO que, confirmado
 *   contra QA real, C4C tambien devuelve reglas de negocio (ej. "Los
 *   datos de Provincia y Distrito no corresponden al Departamento
 *   seleccionado") con HTTP 500 en vez de 400. Por eso la clasificacion
 *   de negocio-vs-transitorio se basa en si hay un mensaje de error
 *   parseado (error.message.value), no en el codigo HTTP exacto.
 */
export class C4CError extends Error {
  readonly httpStatus: number;
  readonly odataErrorCode?: string;
  readonly businessMessage?: string;
  readonly isTransient: boolean;

  constructor(
    message: string,
    httpStatus: number,
    opts: { odataErrorCode?: string; businessMessage?: string; isTransient?: boolean } = {},
  ) {
    super(message);
    this.name = "C4CError";
    this.httpStatus = httpStatus;
    this.odataErrorCode = opts.odataErrorCode;
    this.businessMessage = opts.businessMessage;
    this.isTransient = opts.isTransient ?? isTransientHttpStatus(httpStatus);
  }

  /**
   * true cuando C4C devolvio un mensaje de negocio parseable (ABSL o
   * validacion de datos), sin importar el HTTP status - confirmado que
   * C4C usa tanto 400 como 500 para esto. No reintentable ni generico.
   */
  get isBusinessRuleFailure(): boolean {
    return Boolean(this.businessMessage);
  }

  get isAuthFailure(): boolean {
    return this.httpStatus === 401 || this.httpStatus === 403;
  }
}

export function isTransientHttpStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

interface ODataErrorBody {
  error?: {
    code?: string;
    message?: { value?: string; lang?: string } | string;
  };
}

export async function parseODataError(response: Response): Promise<C4CError> {
  let odataErrorCode: string | undefined;
  let businessMessage: string | undefined;

  try {
    const body = (await response.json()) as ODataErrorBody;
    odataErrorCode = body?.error?.code;
    const msg = body?.error?.message;
    businessMessage = typeof msg === "string" ? msg : msg?.value;
  } catch {
    // Cuerpo vacio o no-JSON (comun en 401/403/504) - se ignora.
  }

  return new C4CError(businessMessage ?? `C4C respondio HTTP ${response.status}`, response.status, {
    odataErrorCode,
    businessMessage,
    // Un 5xx solo se considera transitorio si NO trae un mensaje de negocio
    // parseado - si lo trae, es una regla de negocio, no una falla de infra.
    isTransient: isTransientHttpStatus(response.status) && !businessMessage,
  });
}
