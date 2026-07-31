import type { IC4CODataClient } from "@cerocontacto/c4c-client";
import type { PostalCodeMatch, PostalCodeSearchResult } from "./types.js";

export * from "./types.js";

const NS = "cust/v1/regionxdepartamento";
const CACHE_TTL_MS = 10 * 60_000;
/** Coincide con el $top de la consulta - si se alcanza, puede haber mas registros no traidos. */
const POSSIBLE_TRUNCATION_THRESHOLD = 2000;

interface ActiveRegionRecord {
  zIDDistrito: string;
  zPostalCodigo: string;
}

interface CacheEntry {
  data: ActiveRegionRecord[];
  expiresAt: number;
}

/**
 * Cache en memoria (por departamento) del universo de zonas de cobertura
 * ACTIVAS traido de C4C, sin filtrar por nombre. searchPostalCodes,
 * hasActiveCoverage e isValidPostalCode comparten esta misma fuente para
 * no repetir la misma consulta pesada a produccion en cada keystroke, en
 * cada chequeo de cobertura y en cada validacion.
 */
const activeRecordsCache = new Map<string, CacheEntry>();

function escapeODataString(value: string): string {
  return value.replace(/'/g, "''");
}

/** Solo para tests: limpia el cache en memoria entre casos (evita fugas entre tests que reusan el mismo departamento). */
export function clearActiveRecordsCacheForTests(): void {
  activeRecordsCache.clear();
}

async function getActiveRecords(departamento: string, client: IC4CODataClient): Promise<ActiveRegionRecord[]> {
  const now = Date.now();
  const cached = activeRecordsCache.get(departamento);
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }

  const filter = [`zRegDepart eq '${escapeODataString(departamento)}'`, `zRegactivo eq true`].join(" and ");
  const results = await client.getCollection<ActiveRegionRecord>(
    `${NS}/BO_RegionRootCollection?$filter=${encodeURIComponent(filter)}&$top=2000&$select=zIDDistrito,zPostalCodigo`,
  );

  if (results.length >= POSSIBLE_TRUNCATION_THRESHOLD) {
    console.warn("postal_codes_possible_truncation", { departamento, count: results.length });
  }

  activeRecordsCache.set(departamento, { data: results, expiresAt: now + CACHE_TTL_MS });
  return results;
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
 *
 * regionxdepartamento puede tener mas de un registro real para la misma
 * combinacion distrito+codigo postal (confirmado en vivo, 2026-07-31 -
 * probablemente asociados a distintas empresas/zonas que este buscador no
 * expone) - se deduplican antes de devolver, quedandose con la primera
 * aparicion de cada combinacion.
 */
export async function searchPostalCodes(
  departamento: string,
  query: string,
  client: IC4CODataClient,
): Promise<PostalCodeSearchResult> {
  const trimmed = query.trim();
  if (!departamento || trimmed.length < 2) return { resultados: [], hayMasResultados: false };

  const results = await getActiveRecords(departamento, client);

  const needle = trimmed.toLowerCase();
  const matched = results.filter((r) => r.zIDDistrito.toLowerCase().includes(needle));

  const vistos = new Set<string>();
  const deduplicados: PostalCodeMatch[] = [];
  for (const r of matched) {
    const clave = `${r.zIDDistrito}|${r.zPostalCodigo}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    deduplicados.push({ distrito: r.zIDDistrito, codigoPostal: r.zPostalCodigo });
  }

  return {
    resultados: deduplicados.slice(0, 20),
    hayMasResultados: deduplicados.length > 20,
  };
}

/** true si el departamento tiene al menos una zona de cobertura activa (sin depender de texto de busqueda). */
export async function hasActiveCoverage(departamento: string, client: IC4CODataClient): Promise<boolean> {
  if (!departamento) return false;

  const results = await getActiveRecords(departamento, client);
  return results.length > 0;
}

/**
 * true si `codigoPostal` corresponde exactamente a una zona de cobertura
 * activa dentro de `departamento`. Usado para revalidar un codigo postal
 * autocompletado desde datos guardados de un cliente existente (ese valor
 * nunca paso por esta tabla al momento de guardarse, y puede haber quedado
 * desactualizado si la zona ya no esta activa).
 */
export async function isValidPostalCode(
  departamento: string,
  codigoPostal: string,
  client: IC4CODataClient,
): Promise<boolean> {
  if (!departamento || !codigoPostal) return false;

  const results = await getActiveRecords(departamento, client);
  return results.some((r) => r.zPostalCodigo === codigoPostal);
}
