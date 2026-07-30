import type { IC4CODataClient } from "@cerocontacto/c4c-client";
import type { PostalCodeMatch } from "./types.js";

export * from "./types.js";

const NS = "cust/v1/regionxdepartamento";

function escapeODataString(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Busca zonas de cobertura de servicio ACTIVAS de SOLE por coincidencia
 * parcial de nombre de distrito/zona, dentro de un departamento.
 * regionxdepartamento NO es un catalogo generico de UBIGEO de Peru - es
 * la misma tabla que usa C4C para la regla de negocio "region activa
 * para el codigo postal" al crear un ticket (confirmado en vivo contra
 * produccion, 2026-07-30).
 *
 * El filtro de nombre se aplica del lado del backend, no en el $filter de
 * OData: zIDDistrito esta guardado en C4C con mayusculas/minusculas mixtas
 * ("San Juan de Lurigancho"), y `substringof` en OData es sensible a
 * mayusculas - `tolower()` tampoco esta soportado por este servicio
 * (confirmado en vivo: error 500 "funcion 'tolower' no soportada en
 * ABAP-Selektionsoptiones"). Se trae el universo activo del departamento
 * (maximo real observado ~660 registros) y se filtra en memoria.
 */
export async function searchPostalCodes(
  departamento: string,
  query: string,
  client: IC4CODataClient,
): Promise<PostalCodeMatch[]> {
  const trimmed = query.trim();
  if (!departamento || trimmed.length < 2) return [];

  const filter = [`zRegDepart eq '${escapeODataString(departamento)}'`, `zRegactivo eq true`].join(" and ");

  const results = await client.getCollection<{ zIDDistrito: string; zPostalCodigo: string }>(
    `${NS}/BO_RegionRootCollection?$filter=${encodeURIComponent(filter)}&$top=2000&$select=zIDDistrito,zPostalCodigo`,
  );

  const needle = trimmed.toLowerCase();
  return results
    .filter((r) => r.zIDDistrito.toLowerCase().includes(needle))
    .slice(0, 20)
    .map((r) => ({ distrito: r.zIDDistrito, codigoPostal: r.zPostalCodigo }));
}

/** true si el departamento tiene al menos una zona de cobertura activa (sin depender de texto de busqueda). */
export async function hasActiveCoverage(departamento: string, client: IC4CODataClient): Promise<boolean> {
  if (!departamento) return false;

  const filter = [`zRegDepart eq '${escapeODataString(departamento)}'`, `zRegactivo eq true`].join(" and ");

  const results = await client.getCollection<{ zIDDistrito: string }>(
    `${NS}/BO_RegionRootCollection?$filter=${encodeURIComponent(filter)}&$top=1&$select=zIDDistrito`,
  );

  return results.length > 0;
}
