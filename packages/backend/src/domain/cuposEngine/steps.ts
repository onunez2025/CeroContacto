import type { IC4CODataClient } from "@cerocontacto/c4c-client";
import { and, eq, eqBool, eqRaw, cmpRaw, or } from "@cerocontacto/c4c-client";
import { SERVICE_AREA_ID, SERVICE_TYPE_ID } from "./types.js";
import type {
  CupoPorAreaConFecha,
  CupoPorAreaRoot,
  CuposEmpresaCuposEmpresaFecha,
  CuposEmpresaCuposGrupoMaterial,
  CuposEmpresaCuposTipoServicio,
  CuposEmpresaRoot,
  MaterialSalesProcessInformation,
  RegionRoot,
} from "./types.js";

const CUST_NS = "cust/v1";

export async function getProductGroup(productId: string, client: IC4CODataClient): Promise<string | undefined> {
  const filter = eq("InternalID", productId);
  const results = await client.getCollection<MaterialSalesProcessInformation>(
    `${CUST_NS}/cust_producto/MaterialSalesProcessInformationCollection?$filter=${encodeURIComponent(filter)}`,
  );
  return results[0]?.ProductGroup2;
}

export async function getRegionMeta(postalCode: string, client: IC4CODataClient): Promise<RegionRoot | undefined> {
  const filter = and(eq("zPostalCodigo", postalCode), eqBool("zRegactivo", true));
  const results = await client.getCollection<RegionRoot>(
    `${CUST_NS}/regionxdepartamento/BO_RegionRootCollection?$filter=${encodeURIComponent(filter)}`,
  );
  return results[0];
}

/** Candidatas ordenadas por prioridad descendente, tal como hace el Postman del proveedor. */
export async function getCandidateCompanies(
  regionCode: string,
  client: IC4CODataClient,
): Promise<CuposEmpresaRoot[]> {
  const filter = and(eq("zCupDepart", regionCode), eqBool("zCupactivo", true));
  return client.getCollection<CuposEmpresaRoot>(
    `${CUST_NS}/cupos_empresa/BO_CuposEmpresaRootCollection?$filter=${encodeURIComponent(filter)}&$orderby=zCupPrioridadNEw desc`,
  );
}

export async function isTipoServicioHabilitado(objectId: string, client: IC4CODataClient): Promise<boolean> {
  const filter = eq("zIDTipoServicio", SERVICE_TYPE_ID);
  const results = await client.getCollection<CuposEmpresaCuposTipoServicio>(
    `${CUST_NS}/cupos_empresa/BO_CuposEmpresaRootCollection('${objectId}')/BO_CuposEmpresaCuposTipoServicio?$filter=${encodeURIComponent(filter)}`,
  );
  return results.length > 0;
}

export async function isGrupoMaterialHabilitado(
  objectId: string,
  productGroup: string,
  client: IC4CODataClient,
): Promise<boolean> {
  const filter = eq("zCupIdGrupoMaterial", productGroup);
  const results = await client.getCollection<CuposEmpresaCuposGrupoMaterial>(
    `${CUST_NS}/cupos_empresa/BO_CuposEmpresaRootCollection('${objectId}')/BO_CuposEmpresaCuposGrupoMaterial?$filter=${encodeURIComponent(filter)}`,
  );
  return results.length > 0;
}

export const DAY_FIELDS = [
  "zCupFechDomingo",
  "zCupFechLunes",
  "zCupFechMartes",
  "zCupFechMircoles",
  "zCupFechIJueves",
  "zCupFechViernes",
  "zCupFechSbado",
] as const;

/**
 * Indice de dia de semana (0=Domingo..6=Sabado) de una fecha ISO
 * "YYYY-MM-DD", calculado en UTC para no depender de la zona horaria del
 * proceso que ejecuta esto (la fecha de visita es una fecha calendario,
 * no un instante).
 */
export function dayOfWeekIndex(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay();
}

export function addDaysIso(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Trae el registro completo de dias habilitados (los 7 flags) para una
 * candidata+region, sin evaluar ningun dia en particular - permite
 * reusar el mismo registro para varias fechas sin volver a consultar C4C.
 */
export async function getDiasHabilitados(
  objectId: string,
  regionCode: string,
  cabRegion: string,
  client: IC4CODataClient,
): Promise<CuposEmpresaCuposEmpresaFecha | undefined> {
  const filter = and(eq("zCupFechDepartamento", regionCode), eq("zCupFechRegin", cabRegion));
  const results = await client.getCollection<CuposEmpresaCuposEmpresaFecha>(
    `${CUST_NS}/cupos_empresa/BO_CuposEmpresaRootCollection('${objectId}')/BO_CuposEmpresaCuposEmpresaFecha?$filter=${encodeURIComponent(filter)}`,
  );
  return results[0];
}

/**
 * Se evalua sobre la FECHA DE VISITA SOLICITADA (no la fecha actual del
 * sistema) - el spec del proveedor es ambiguo en esto (su script de
 * Postman usa `new Date().getDay()`, el dia en que se ejecuta la prueba),
 * pero el chequeo tiene sentido de negocio como "el contratista trabaja
 * ese dia de la semana", que solo aplica al dia de la visita. Confirmar
 * con el proveedor (pregunta E de la seccion de motor de cupos).
 */
export async function isDiaHabilitado(
  objectId: string,
  regionCode: string,
  cabRegion: string,
  fechaVisita: string,
  client: IC4CODataClient,
): Promise<boolean> {
  const record = await getDiasHabilitados(objectId, regionCode, cabRegion, client);
  if (!record) return false;

  const field = DAY_FIELDS[dayOfWeekIndex(fechaVisita)];
  return field !== undefined && record[field] === true;
}

/**
 * Verifica capacidad usando zCantidadDisponible (campo calculado por SAP,
 * confirmado en QA - no estaba en el spec original del proveedor, que
 * comparaba zCantidadProgramada < zCantidadPlanificada manualmente).
 */
export async function checkCapacidad(
  regionCode: string,
  companyId: string,
  fechaVisita: string,
  client: IC4CODataClient,
): Promise<CupoPorAreaRoot | undefined> {
  // El literal datetime de OData v2 exige hora completa (yyyy-mm-ddThh:mm:ss);
  // confirmado en QA real - pasar solo la fecha produce "Invalid token".
  const filter = and(
    eq("zIdArea", SERVICE_AREA_ID),
    eq("zDepartamento", regionCode),
    eq("zIdEmpresa", companyId),
    eqBool("zActivo", true),
    eqRaw("zFecha", `datetime'${fechaVisita}T00:00:00'`),
  );
  const results = await client.getCollection<CupoPorAreaRoot>(
    `${CUST_NS}/cupoporarea/BO_CupoPorAreaRootCollection?$filter=${encodeURIComponent(filter)}`,
  );
  const record = results[0];
  if (!record || record.zCantidadDisponible <= 0) return undefined;
  return record;
}

/**
 * Version en rango de checkCapacidad: en vez de una fecha y una empresa,
 * trae en UNA sola consulta todos los registros de capacidad de varias
 * empresas candidatas para un rango de fechas, ya filtrados por
 * "mas de 10 cupos disponibles". Se usa para calcular que fechas mostrar
 * habilitadas en el calendario, sin consultar C4C dia por dia.
 */
export async function checkCapacidadRango(
  regionCode: string,
  companyIds: string[],
  desde: string,
  hasta: string,
  client: IC4CODataClient,
): Promise<CupoPorAreaConFecha[]> {
  if (companyIds.length === 0) return [];

  // C4C rechaza este $filter si se agrega tambien "zFecha le ..." (confirmado
  // en vivo contra QA: "Error in filter System Query, Operation failed::
  // Expression can not converted into ABAP select options" - un rango de dos
  // lados sobre zFecha combinado con otros campos no se puede convertir a
  // select-options en este servicio OData). Un solo lado (ge) combinado con
  // el resto de campos si funciona, asi que el limite superior se filtra
  // aca en vez de en el $filter.
  const filter = and(
    eq("zIdArea", SERVICE_AREA_ID),
    eq("zDepartamento", regionCode),
    eqBool("zActivo", true),
    cmpRaw("zCantidadDisponible", "gt", "10"),
    or(...companyIds.map((id) => eq("zIdEmpresa", id))),
    cmpRaw("zFecha", "ge", `datetime'${desde}T00:00:00'`),
  );
  const results = await client.getCollection<CupoPorAreaConFecha>(
    `${CUST_NS}/cupoporarea/BO_CupoPorAreaRootCollection?$filter=${encodeURIComponent(filter)}&$select=zCantidadDisponible,zIdEmpresa,zFecha`,
  );
  return results
    .map((r) => ({ ...r, zFecha: parseODataJsonDate(r.zFecha) }))
    .filter((r) => r.zFecha <= hasta);
}

/**
 * El JSON verbose de OData v2 (el formato que devuelve C4C) serializa los
 * campos de fecha/hora como "/Date(<ms-epoch>)/", no como texto ISO -
 * confirmado en vivo (checkCapacidadRango devolvia zFecha: "/Date(...)/"
 * y por eso ninguna fecha real hacia match con el rango solicitado, un bug
 * que solo se manifesto una vez que C4C QA tuvo datos de cupos futuros
 * reales para probar). Convierte a "YYYY-MM-DD".
 */
function parseODataJsonDate(value: string): string {
  const match = /\/Date\((\d+)\)\//.exec(value);
  if (!match?.[1]) return value.slice(0, 10);
  return new Date(Number(match[1])).toISOString().slice(0, 10);
}
