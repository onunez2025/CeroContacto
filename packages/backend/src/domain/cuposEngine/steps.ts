import type { IC4CODataClient } from "@cerocontacto/c4c-client";
import { and, eq, eqBool, eqRaw } from "@cerocontacto/c4c-client";
import { SERVICE_AREA_ID, SERVICE_TYPE_ID } from "./types.js";
import type {
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

const DAY_FIELDS = [
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
  const filter = and(eq("zCupFechDepartamento", regionCode), eq("zCupFechRegin", cabRegion));
  const results = await client.getCollection<CuposEmpresaCuposEmpresaFecha>(
    `${CUST_NS}/cupos_empresa/BO_CuposEmpresaRootCollection('${objectId}')/BO_CuposEmpresaCuposEmpresaFecha?$filter=${encodeURIComponent(filter)}`,
  );
  const record = results[0];
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
