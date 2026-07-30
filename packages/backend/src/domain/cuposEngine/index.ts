import type { IC4CODataClient } from "@cerocontacto/c4c-client";
import {
  addDaysIso,
  checkCapacidad,
  checkCapacidadRango,
  DAY_FIELDS,
  dayOfWeekIndex,
  getCandidateCompanies,
  getDiasHabilitados,
  getProductGroup,
  getRegionMeta,
  isDiaHabilitado,
  isGrupoMaterialHabilitado,
  isTipoServicioHabilitado,
} from "./steps.js";
import type { CuposEngineInput, CuposEngineResult, FechasDisponiblesInput } from "./types.js";

export * from "./types.js";

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

  const region = await getRegionMeta(input.postalCode, client);
  if (!region?.zRegRegin || !region.zRegcode || !region.zRegid) {
    return {
      ok: false,
      reason: "NO_REGION_MATCH",
      detail: `No se encontro region activa para el codigo postal ${input.postalCode}`,
    };
  }
  const { zRegRegin: cabRegion, zRegcode: regionFsm, zRegid: regionFsmId } = region;

  const candidates = await getCandidateCompanies(input.regionCode, client);
  if (candidates.length === 0) {
    return {
      ok: false,
      reason: "NO_CANDIDATE_COMPANY",
      detail: `No hay empresas activas para el departamento ${input.regionCode}`,
    };
  }

  for (const candidate of candidates) {
    const [tipoServicioOk, grupoMaterialChecks, diaHabilitadoOk] = await Promise.all([
      isTipoServicioHabilitado(candidate.ObjectID, client),
      Promise.all(distinctGroups.map((group) => isGrupoMaterialHabilitado(candidate.ObjectID, group, client))),
      isDiaHabilitado(candidate.ObjectID, input.regionCode, cabRegion, input.fechaVisita, client),
    ]);
    const grupoMaterialOk = grupoMaterialChecks.every(Boolean);

    if (!tipoServicioOk || !grupoMaterialOk || !diaHabilitadoOk) continue;

    const cupo = await checkCapacidad(input.regionCode, candidate.zCupIdEmpresa, input.fechaVisita, client);
    if (!cupo) continue;

    return {
      ok: true,
      companyId: candidate.zCupIdEmpresa,
      reservationId: cupo.zIdRegistro,
      cabRegion,
      regionFsm,
      regionFsmId,
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
  const region = await getRegionMeta(input.postalCode, client);
  if (!region?.zRegRegin) return [];
  const cabRegion = region.zRegRegin;

  const candidates = await getCandidateCompanies(input.regionCode, client);
  if (candidates.length === 0) return [];

  const elegibles: { zCupIdEmpresa: string; dias: Awaited<ReturnType<typeof getDiasHabilitados>> }[] = [];
  for (const candidate of candidates) {
    const dias = await getDiasHabilitados(candidate.ObjectID, input.regionCode, cabRegion, client);
    elegibles.push({ zCupIdEmpresa: candidate.zCupIdEmpresa, dias });
  }

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
    const weekday = DAY_FIELDS[dayOfWeekIndex(cursor)];
    const calificaAlguna = elegibles.some((empresa) => {
      if (!empresa.dias || weekday === undefined || empresa.dias[weekday] !== true) return false;
      return fechasPorEmpresa.get(empresa.zCupIdEmpresa)?.has(cursor) ?? false;
    });
    if (calificaAlguna) fechasDisponibles.push(cursor);
  }

  return fechasDisponibles;
}
