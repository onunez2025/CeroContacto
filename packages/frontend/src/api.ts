import type { ServiceRequestSubmission } from "@cerocontacto/shared";

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
