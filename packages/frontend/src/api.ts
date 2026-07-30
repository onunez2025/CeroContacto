import type { Address, ServiceRequestSubmission } from "@cerocontacto/shared";

export interface SubmitSuccess {
  status: "Completed";
  /** Un ticket por producto de la solicitud (combo cocina+horno+campana = 3 tickets). */
  ticketIds: string[];
}

export interface SubmitFailure {
  status: "Failed";
  errorMessage: string;
}

export type SubmitResult = SubmitSuccess | SubmitFailure;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * v1: el backend procesa la solicitud de forma sincrona (varias llamadas
 * secuenciales a C4C, puede tardar decenas de segundos) y devuelve el
 * resultado final en la misma respuesta - no hay polling todavia.
 */
export async function submitServiceRequest(payload: ServiceRequestSubmission): Promise<SubmitResult> {
  const res = await fetch("/api/service-requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const body = (await res.json().catch(() => undefined)) as
    | { status?: string; ticketIds?: string[]; errorMessage?: string; error?: string; details?: unknown }
    | undefined;

  if (res.status === 400) {
    throw new ApiError(body?.error ?? "Los datos ingresados no son validos.", body?.details);
  }
  if (!res.ok) {
    throw new ApiError(body?.error ?? "No pudimos conectarnos con el servidor. Intenta de nuevo.");
  }

  if (body?.status === "Completed" && body.ticketIds?.length) {
    return { status: "Completed", ticketIds: body.ticketIds };
  }
  return { status: "Failed", errorMessage: body?.errorMessage ?? "No pudimos procesar tu solicitud." };
}

export interface ProductCatalogItem {
  productId: string;
  nombre: string;
}

/** Autocompletado de modelo dentro de una categoria - consulta el catalogo real (C4C produccion, solo lectura). */
export async function searchProducts(categoriaId: string, query: string): Promise<ProductCatalogItem[]> {
  const params = new URLSearchParams({ categoria: categoriaId, q: query });
  const res = await fetch(`/api/productos?${params.toString()}`);
  const body = (await res.json().catch(() => undefined)) as
    | { productos?: ProductCatalogItem[]; error?: string }
    | undefined;
  if (!res.ok) {
    throw new ApiError(body?.error ?? "No pudimos buscar productos. Intenta de nuevo.");
  }
  return body?.productos ?? [];
}

export async function getFechasDisponibles(departamento: string, codigoPostal: string): Promise<string[]> {
  const params = new URLSearchParams({ departamento, codigoPostal });
  const res = await fetch(`/api/fechas-disponibles?${params.toString()}`);
  const body = (await res.json().catch(() => undefined)) as { fechas?: string[]; error?: string } | undefined;
  if (!res.ok) {
    throw new ApiError(body?.error ?? "No pudimos cargar las fechas disponibles.");
  }
  return body?.fechas ?? [];
}

export interface CustomerLookupData {
  nombres?: string;
  apellidos?: string;
  razonSocial?: string;
  telefono: string;
  email: string;
  direccion: Partial<Address>;
}

export interface CustomerLookupResult {
  found: boolean;
  datos?: CustomerLookupData;
}

/**
 * Busca si el cliente ya existe en C4C por su documento, para autocompletar
 * el formulario. Nunca lanza por "no encontrado" (found:false es un
 * resultado valido) - solo por error real de red/servidor, y el caller
 * decide ignorarlo en silencio.
 */
export async function lookupCustomer(
  tipoDocumento: "DNI" | "CE" | "RUC",
  numeroDocumento: string,
): Promise<CustomerLookupResult> {
  const params = new URLSearchParams({ tipoDocumento, numeroDocumento });
  const res = await fetch(`/api/clientes/lookup?${params.toString()}`);
  if (!res.ok) {
    throw new ApiError("No pudimos buscar tus datos.");
  }
  const body = (await res.json().catch(() => undefined)) as CustomerLookupResult | undefined;
  return body ?? { found: false };
}

export interface PostalCodeMatch {
  distrito: string;
  codigoPostal: string;
}

export interface PostalCodeSearchResult {
  resultados: PostalCodeMatch[];
  /** true si la busqueda encontro mas de 20 coincidencias (se recortan a 20) - hay que seguir escribiendo para acotar. */
  hayMasResultados: boolean;
}

/** Busca codigos postales (zonas de cobertura activas de SOLE) por nombre de distrito/zona, dentro de un departamento. */
export async function searchPostalCodes(departamento: string, query: string): Promise<PostalCodeSearchResult> {
  const params = new URLSearchParams({ departamento, q: query });
  const res = await fetch(`/api/codigos-postales?${params.toString()}`);
  const body = (await res.json().catch(() => undefined)) as
    | { resultados?: PostalCodeMatch[]; hayMasResultados?: boolean; error?: string }
    | undefined;
  if (!res.ok) {
    throw new ApiError(body?.error ?? "No pudimos buscar codigos postales. Intenta de nuevo.");
  }
  return { resultados: body?.resultados ?? [], hayMasResultados: body?.hayMasResultados ?? false };
}

/**
 * true si el departamento tiene al menos una zona de cobertura de servicio
 * activa. Lanza ApiError ante cualquier falla (red o respuesta no-ok) - a
 * diferencia de una version anterior, NO se traga los errores como
 * "false": un hipo transitorio (502, corte de red) no es lo mismo que una
 * confirmacion real de "cero cobertura", y tratarlos igual bloqueaba la
 * entrada de direccion por una falla pasajera. El caller decide como
 * degradar (fail-open) ante el catch.
 */
export async function hasActiveCoverage(departamento: string): Promise<boolean> {
  const params = new URLSearchParams({ departamento });
  const res = await fetch(`/api/codigos-postales/cobertura?${params.toString()}`);
  const body = (await res.json().catch(() => undefined)) as { tieneCobertura?: boolean; error?: string } | undefined;
  if (!res.ok) {
    throw new ApiError(body?.error ?? "No pudimos verificar la cobertura. Intenta de nuevo.");
  }
  return body?.tieneCobertura ?? false;
}

/**
 * Valida un codigo postal autocompletado desde datos de un cliente existente
 * (nunca paso por regionxdepartamento al momento de guardarse en C4C) contra
 * el universo de zonas de cobertura activas. Falla ABIERTO (resuelve true)
 * ante cualquier error de red o de servidor: un hipo transitorio nunca debe
 * borrar un codigo postal real y valido de un cliente existente - solo una
 * respuesta exitosa y explicita {valido:false} debe invalidarlo.
 */
export async function validatePostalCode(departamento: string, codigoPostal: string): Promise<boolean> {
  try {
    const params = new URLSearchParams({ departamento, codigoPostal });
    const res = await fetch(`/api/codigos-postales/validar?${params.toString()}`);
    if (!res.ok) return true;
    const body = (await res.json().catch(() => undefined)) as { valido?: boolean } | undefined;
    return body?.valido ?? true;
  } catch {
    return true;
  }
}
