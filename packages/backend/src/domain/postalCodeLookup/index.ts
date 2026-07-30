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
 */
export async function searchPostalCodes(
  departamento: string,
  query: string,
  client: IC4CODataClient,
): Promise<PostalCodeMatch[]> {
  const trimmed = query.trim();
  if (!departamento || trimmed.length < 2) return [];

  const filter = [
    `zRegDepart eq '${escapeODataString(departamento)}'`,
    `zRegactivo eq true`,
    `substringof('${escapeODataString(trimmed.toUpperCase())}',zIDDistrito)`,
  ].join(" and ");

  const results = await client.getCollection<{ zIDDistrito: string; zPostalCodigo: string }>(
    `${NS}/BO_RegionRootCollection?$filter=${encodeURIComponent(filter)}&$top=20&$select=zIDDistrito,zPostalCodigo`,
  );

  return results.map((r) => ({ distrito: r.zIDDistrito, codigoPostal: r.zPostalCodigo }));
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
