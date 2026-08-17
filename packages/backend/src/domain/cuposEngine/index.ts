import type { IC4CODataClient } from "@cerocontacto/c4c-client";
import {
  addDaysIso,
  checkCapacidad,
  checkCapacidadRango,
  getCandidateCompanies,
  getDiasHabilitados,
  getProductGroup,
  getRegionMetas,
  habilitaDia,
  isGrupoMaterialHabilitado,
  isTipoServicioHabilitado,
  regionQueAtiendeElDia,
} from "./steps.js";
import type { CuposEngineInput, CuposEngineResult, FechasDisponiblesInput } from "./types.js";

export * from "./types.js";

const FECHAS_DISPONIBLES_CACHE_TTL_MS = 10 * 60_000;

interface FechasDisponiblesCacheEntry {
  data: string[];
  expiresAt: number;
}

/**
 * Cache en memoria del resultado completo de getFechasDisponibles, por
 * combinacion exacta de departamento+codigoPostal+rango de fechas.
 * Confirmado en vivo (2026-07-30): un departamento con ~20 empresas
 * candidatas tarda ~4s en frio (region + candidatas + Promise.all de dias
 * habilitados + capacidad, cada paso ~0.8-1s) - paralelizar las consultas
 * por empresa si ayuda (bajo de ~21s a ~4s frente a hacerlas en serie).
 * Este cache evita repetir incluso esos ~4s para el mismo departamento y
 * codigo postal dentro de la ventana de 10 min (confirmado: ~4s en frio,
 * ~60ms en caliente).
 */
const fechasDisponiblesCache = new Map<string, FechasDisponiblesCacheEntry>();

/** Solo para tests: limpia el cache en memoria entre casos. */
export function clearFechasDisponiblesCacheForTests(): void {
  fechasDisponiblesCache.clear();
}

/**
 * Motor de cupos (7 pasos). A diferencia del Postman del proveedor, que
 * se detiene en la primera empresa candidata, este motor itera todas las
 * candidatas en orden de prioridad hasta encontrar una que pase los 3
 * chequeos de habilitacion (TipoServicio, GrupoMaterial, DiaHabilitado) Y
 * tenga capacidad disponible para la fecha solicitada.
 */
export async function assignCupo(input: CuposEngineInput, client: IC4CODataClient): Promise<CuposEngineResult> {
  const productGroups = new Set<string>();
  for (const productId of input.productIds) {
    const group = await getProductGroup(productId, client);
    if (!group) {
      return {
        ok: false,
        reason: "NO_PRODUCT_GROUP",
        detail: `No se encontro grupo de material para el ProductID ${productId}`,
      };
    }
    productGroups.add(group);
  }
  const distinctGroups = [...productGroups];

  // Todas las regiones que cubren este codigo postal, no una sola: ver la
  // nota de getRegionMetas (observacion 20 - Callao).
  const regiones = await getRegionMetas(input.postalCode, client);
  if (regiones.length === 0) {
    return {
      ok: false,
      reason: "NO_REGION_MATCH",
      detail: `No se encontro region activa para el codigo postal ${input.postalCode}`,
    };
  }

  const candidates = await getCandidateCompanies(input.regionCode, client);
  if (candidates.length === 0) {
    return {
      ok: false,
      reason: "NO_CANDIDATE_COMPANY",
      detail: `No hay empresas activas para el departamento ${input.regionCode}`,
    };
  }

  for (const candidate of candidates) {
    const [tipoServicioOk, grupoMaterialChecks, regionDelCandidato] = await Promise.all([
      isTipoServicioHabilitado(candidate.ObjectID, client),
      Promise.all(distinctGroups.map((group) => isGrupoMaterialHabilitado(candidate.ObjectID, group, client))),
      regionQueAtiendeElDia(candidate.ObjectID, input.regionCode, regiones, input.fechaVisita, client),
    ]);
    const grupoMaterialOk = grupoMaterialChecks.every(Boolean);

    if (!tipoServicioOk || !grupoMaterialOk || !regionDelCandidato) continue;

    const cupo = await checkCapacidad(input.regionCode, candidate.zCupIdEmpresa, input.fechaVisita, client);
    if (!cupo) continue;

    // La region que viaja al ticket es la de ESTA empresa, no la primera que
    // devolviera C4C para el codigo postal: son contratistas distintos
    // cubriendo la misma zona.
    return {
      ok: true,
      companyId: candidate.zCupIdEmpresa,
      reservationId: cupo.zIdRegistro,
      cabRegion: regionDelCandidato.cabRegion,
      regionFsm: regionDelCandidato.regionFsm,
      regionFsmId: regionDelCandidato.regionFsmId,
    };
  }

  return {
    ok: false,
    reason: "NO_CAPACITY",
    detail: `Ninguna empresa candidata en ${input.regionCode} tuvo cupo disponible para ${input.fechaVisita}`,
  };
}

/**
 * Calcula que fechas del rango [input.desde, input.hasta] tienen mas de
 * 10 cupos reales disponibles para alguna empresa candidata del
 * departamento (activa y con el dia de semana habilitado). No filtra por
 * grupo de material/tipo de servicio: los servicios de C4C que harian
 * falta para eso (cust_producto, chequeo de tipo de servicio) no existen
 * en produccion todavia (confirmado en vivo, 2026-07-30) - ver
 * assignCupo, que si los necesita y por eso sigue deshabilitado. Se usa
 * para restringir el calendario del formulario; no reserva nada.
 */
export async function getFechasDisponibles(input: FechasDisponiblesInput, client: IC4CODataClient): Promise<string[]> {
  const cacheKey = `${input.postalCode}|${input.regionCode}|${input.desde}|${input.hasta}`;
  const now = Date.now();
  const cached = fechasDisponiblesCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.data;

  const fechasDisponibles = await computeFechasDisponibles(input, client);
  fechasDisponiblesCache.set(cacheKey, { data: fechasDisponibles, expiresAt: now + FECHAS_DISPONIBLES_CACHE_TTL_MS });
  return fechasDisponibles;
}

/** Limite de solicitudes simultaneas a C4C por el fan-out de empresas candidatas. */
const CANDIDATOS_CONCURRENCIA_MAXIMA = 8;

/**
 * Aplica `fn` a cada elemento de `items`, en lotes de a lo sumo `limit` en
 * paralelo (no una unica Promise.all sin limite). Evita que un
 * departamento con muchas empresas candidatas (Lima tiene ~20) dispare
 * todas sus solicitudes a C4C produccion al mismo tiempo - confirmado en
 * revision final (2026-07-30) como riesgo real bajo carga concurrente de
 * varios usuarios a la vez, no solo un usuario aislado.
 */
async function mapWithConcurrencyLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await fn(item);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function computeFechasDisponibles(input: FechasDisponiblesInput, client: IC4CODataClient): Promise<string[]> {
  // TODAS las regiones que cubren este codigo postal. Quedarse con una sola
  // (lo que se hacia antes) dejaba el calendario vacio en zonas cubiertas
  // por varios contratistas - ver getRegionMetas (observacion 20, Callao).
  const regiones = await getRegionMetas(input.postalCode, client);
  if (regiones.length === 0) return [];
  const cabRegiones = new Set(regiones.map((r) => r.cabRegion));

  const candidates = await getCandidateCompanies(input.regionCode, client);
  if (candidates.length === 0) return [];

  // Consultas independientes entre si - en paralelo (acotado a
  // CANDIDATOS_CONCURRENCIA_MAXIMA a la vez) en vez de secuenciales
  // (confirmado en vivo, 2026-07-30: ~20 candidatas tardaban ~21s en serie,
  // ~1.2s en paralelo sin limite - el limite evita que muchos usuarios
  // concurrentes multipliquen ese fan-out sin control).
  const elegibles = await mapWithConcurrencyLimit(candidates, CANDIDATOS_CONCURRENCIA_MAXIMA, async (candidate) => ({
    zCupIdEmpresa: candidate.zCupIdEmpresa,
    dias: await getDiasHabilitados(candidate.ObjectID, input.regionCode, cabRegiones, client),
  }));

  const cupos = await checkCapacidadRango(
    input.regionCode,
    elegibles.map((e) => e.zCupIdEmpresa),
    input.desde,
    input.hasta,
    client,
  );
  const fechasPorEmpresa = new Map<string, Set<string>>();
  for (const cupo of cupos) {
    if (!fechasPorEmpresa.has(cupo.zIdEmpresa)) fechasPorEmpresa.set(cupo.zIdEmpresa, new Set());
    fechasPorEmpresa.get(cupo.zIdEmpresa)?.add(cupo.zFecha.slice(0, 10));
  }

  const fechasDisponibles: string[] = [];
  for (let cursor = input.desde; cursor <= input.hasta; cursor = addDaysIso(cursor, 1)) {
    const calificaAlguna = elegibles.some((empresa) => {
      // Basta con que UNA de las regiones con que esta empresa cubre la zona
      // habilite ese dia de la semana.
      if (!habilitaDia(empresa.dias, cursor)) return false;
      return fechasPorEmpresa.get(empresa.zCupIdEmpresa)?.has(cursor) ?? false;
    });
    if (calificaAlguna) fechasDisponibles.push(cursor);
  }

  return fechasDisponibles;
}
