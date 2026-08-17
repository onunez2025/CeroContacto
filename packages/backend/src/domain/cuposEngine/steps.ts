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
  RegionMeta,
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

/**
 * TODAS las regiones de servicio activas que cubren un codigo postal.
 *
 * Un codigo postal NO pertenece a una sola region: en Callao y Lima, varias
 * empresas cubren la misma zona, cada una con su propia region
 * ("SOLE-CALLAO", "FAZZIO-CALLAO", "EMSS-CALLAO"...). Antes esta funcion
 * devolvia `results[0]` - una sola, la primera que devolviera C4C, sin
 * ningun criterio - y todo el motor quedaba atado a esa.
 *
 * Eso rompia zonas reales: los 6 codigos postales de Ventanilla tienen
 * "EMSS-CALLAO" como primer registro, y NINGUNA empresa tiene dias
 * habilitados para esa region, asi que el calendario salia vacio aunque las
 * mismas zonas tambien pertenecen a SOLE-CALLAO/SILAR-CALLAO/FAZZIO-CALLAO,
 * que si tienen contratista con dias y cupos. Confirmado en vivo contra
 * produccion el 2026-08-17: 6 de los 16 codigos postales de Callao y 6 de
 * Lima pasaban de 0 a 39 fechas disponibles con este cambio, y los que ya
 * funcionaban no cambiaron (observacion 20 del usuario).
 */
export async function getRegionMetas(postalCode: string, client: IC4CODataClient): Promise<RegionMeta[]> {
  const filter = and(eq("zPostalCodigo", postalCode), eqBool("zRegactivo", true));
  const results = await client.getCollection<RegionRoot>(
    `${CUST_NS}/regionxdepartamento/BO_RegionRootCollection?$filter=${encodeURIComponent(filter)}`,
  );

  const vistas = new Set<string>();
  const metas: RegionMeta[] = [];
  for (const r of results) {
    if (!r.zRegRegin || !r.zRegcode || !r.zRegid) continue;
    if (vistas.has(r.zRegRegin)) continue;
    vistas.add(r.zRegRegin);
    metas.push({ cabRegion: r.zRegRegin, regionFsm: r.zRegcode, regionFsmId: r.zRegid });
  }
  return metas;
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

/**
 * Minimo de cupos reales disponibles para que una fecha se ofrezca en el
 * calendario. Bajado de 10 a 3 por pedido del negocio (observacion 19,
 * 2026-08-17): con el umbral en 10 quedaban fuera del calendario zonas que
 * si tenian cupos utilizables, sobre todo areas chicas cuya capacidad
 * diaria nunca pasa de 10 - el cliente veia "no tenemos fechas
 * disponibles" para un dia que en C4C si tenia cupo.
 */
const MIN_CUPOS_DISPONIBLES = 3;

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
 * Trae los registros de dias habilitados (los 7 flags) de una candidata en
 * un departamento, para TODAS las regiones que esa empresa atienda ahi, sin
 * evaluar ningun dia en particular - permite reusar los mismos registros
 * para varias fechas sin volver a consultar C4C.
 *
 * La region NO se filtra en el $filter de OData a proposito: un codigo
 * postal puede pertenecer a varias regiones (ver getRegionMetas) y filtrar
 * por una sola en C4C obligaria a una consulta por cada combinacion
 * empresa x region (11 x 6 = 66 en Callao). El registro por empresa es
 * diminuto - 1 fila en Callao, medido en vivo - asi que se trae completo y
 * se cruza en memoria con `regionesDelCliente`.
 */
export async function getDiasHabilitados(
  objectId: string,
  regionCode: string,
  regionesDelCliente: Set<string>,
  client: IC4CODataClient,
): Promise<CuposEmpresaCuposEmpresaFecha[]> {
  const filter = eq("zCupFechDepartamento", regionCode);
  const results = await client.getCollection<CuposEmpresaCuposEmpresaFecha>(
    `${CUST_NS}/cupos_empresa/BO_CuposEmpresaRootCollection('${objectId}')/BO_CuposEmpresaCuposEmpresaFecha?$filter=${encodeURIComponent(filter)}`,
  );
  return results.filter((r) => r.zCupFechRegin !== undefined && regionesDelCliente.has(r.zCupFechRegin));
}

/** true si alguno de los registros habilita ese dia de la semana. */
export function habilitaDia(registros: CuposEmpresaCuposEmpresaFecha[], fecha: string): boolean {
  const field = DAY_FIELDS[dayOfWeekIndex(fecha)];
  if (field === undefined) return false;
  return registros.some((r) => r[field] === true);
}

/**
 * Se evalua sobre la FECHA DE VISITA SOLICITADA (no la fecha actual del
 * sistema) - el spec del proveedor es ambiguo en esto (su script de
 * Postman usa `new Date().getDay()`, el dia en que se ejecuta la prueba),
 * pero el chequeo tiene sentido de negocio como "el contratista trabaja
 * ese dia de la semana", que solo aplica al dia de la visita. Confirmar
 * con el proveedor (pregunta E de la seccion de motor de cupos).
 *
 * Devuelve la region concreta con la que la empresa atiende esa direccion
 * ese dia (no un booleano): es la que debe viajar al ticket como
 * Z_CabRegion_KUT, y con varias regiones por codigo postal ya no se puede
 * asumir cual fue.
 */
export async function regionQueAtiendeElDia(
  objectId: string,
  regionCode: string,
  regionesDelCliente: RegionMeta[],
  fechaVisita: string,
  client: IC4CODataClient,
): Promise<RegionMeta | undefined> {
  const field = DAY_FIELDS[dayOfWeekIndex(fechaVisita)];
  if (field === undefined) return undefined;

  const registros = await getDiasHabilitados(
    objectId,
    regionCode,
    new Set(regionesDelCliente.map((r) => r.cabRegion)),
    client,
  );
  const habilitado = registros.find((r) => r[field] === true);
  if (!habilitado) return undefined;

  return regionesDelCliente.find((r) => r.cabRegion === habilitado.zCupFechRegin);
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
 * trae en UNA sola consulta todos los registros de capacidad REAL (ya
 * descontando reservas) de varias empresas candidatas para un rango de
 * fechas, ya filtrados por MIN_CUPOS_DISPONIBLES. Se usa para
 * calcular que fechas mostrar habilitadas en el calendario, sin consultar
 * C4C dia por dia.
 *
 * Usa el servicio "cupos_x_empresa_x_fecha" (BO_CuposPorEmpresaPorFechaRoot),
 * confirmado en vivo contra produccion (2026-07-30) - NO "cupoporarea", que
 * nunca existio como servicio OData ("No implementation for service"). Este
 * servicio no tiene campo de "area" (a diferencia de "plantilla_cuposarea",
 * que si lo tiene pero no desglosa por departamento) - la capacidad real se
 * filtra solo por departamento + empresa + fecha + activo.
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
  // en vivo contra produccion, 2026-07-30, mismo error que en el servicio
  // anterior: "Error in filter System Query, Operation failed:: Expression
  // can not converted into ABAP select options"). Un solo lado (ge) combinado
  // con el resto de campos si funciona, asi que el limite superior se filtra
  // aca en vez de en el $filter.
  const filter = and(
    eq("zDepartamento", regionCode),
    eqBool("zActivo", true),
    cmpRaw("zCantidadReal", "gt", String(MIN_CUPOS_DISPONIBLES)),
    or(...companyIds.map((id) => eq("zIdEmpresa", id))),
    cmpRaw("zFecha", "ge", `datetime'${desde}T00:00:00'`),
  );
  const results = await client.getCollection<CupoPorAreaConFecha>(
    `${CUST_NS}/cupos_x_empresa_x_fecha/BO_CuposPorEmpresaPorFechaRootCollection?$filter=${encodeURIComponent(filter)}&$select=zCantidadReal,zIdEmpresa,zFecha`,
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
