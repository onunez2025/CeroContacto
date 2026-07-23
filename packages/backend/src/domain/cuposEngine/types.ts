/**
 * Motor de cupos: asigna un contratista/empresa con capacidad disponible
 * para la fecha de visita solicitada. Basado en la estructura confirmada
 * en vivo contra C4C QA (my360657) - ver hallazgos del 2026-07-14:
 * Produccion (my361897) todavia no tiene BO_CuposEmpresaCuposTipoServicio
 * ni los servicios cupoporarea/cust_producto desplegados, asi que este
 * motor solo puede probarse en QA hasta que el proveedor transporte esos
 * customizing objects.
 */

/** Area de servicio "Instalacion" (confirmado en datos reales de cupoporarea). */
export const SERVICE_AREA_ID = "4";

/** Tipo de servicio "Instalacion". Fijo hasta que Mantenimiento entre en alcance (pregunta G1). */
export const SERVICE_TYPE_ID = "CA_1";

export interface CuposEngineInput {
  /**
   * ProductID maestro de CADA producto de la solicitud (1 a 4, ej. combo
   * cocina+horno+campana). El motor corre una sola vez para toda la
   * solicitud: una candidata solo califica si esta habilitada para TODOS
   * los grupos de material distintos de los productos pedidos - una sola
   * visita/contratista para todos.
   */
  productIds: string[];
  /** Codigo postal del cliente, usado para resolver metadata de region. */
  postalCode: string;
  /** StateCode/departamento del cliente (ej. "15"=Lima) - filtra empresas candidatas. */
  regionCode: string;
  /** Fecha de visita solicitada (ISO date), usada para el chequeo de dia habilitado y de capacidad. */
  fechaVisita: string;
}

export interface CuposEngineSuccess {
  ok: true;
  /** zCupIdEmpresa de la empresa/contratista asignado -> zIDEmpresa_SDK del ticket. */
  companyId: string;
  /** zIdRegistro de la reserva de cupo -> zIDRegistroCupoArea_SDK del ticket. */
  reservationId: string;
  /** zRegRegin -> Z_CabRegion_KUT del ticket. */
  cabRegion: string;
  /** zRegcode -> zaRegionFSM_KUT del ticket. */
  regionFsm: string;
  /** zRegid -> zaRegionFSM_ID_KUT del ticket. */
  regionFsmId: string;
}

export type CuposEngineFailureReason =
  | "NO_PRODUCT_GROUP"
  | "NO_REGION_MATCH"
  | "NO_CANDIDATE_COMPANY"
  | "NO_CAPACITY";

export interface CuposEngineFailure {
  ok: false;
  reason: CuposEngineFailureReason;
  detail: string;
}

export type CuposEngineResult = CuposEngineSuccess | CuposEngineFailure;

export interface MaterialSalesProcessInformation {
  ProductGroup2?: string;
}

export interface RegionRoot {
  zRegRegin?: string;
  zRegcode?: string;
  zRegid?: string;
}

export interface CuposEmpresaRoot {
  ObjectID: string;
  zCupIdEmpresa: string;
  zCupPrioridadNEw: number;
  zCupDepart: string;
  zCupactivo: boolean;
}

export interface CuposEmpresaCuposTipoServicio {
  zIDTipoServicio: string;
}

export interface CuposEmpresaCuposGrupoMaterial {
  zCupIdGrupoMaterial: string;
}

export interface CuposEmpresaCuposEmpresaFecha {
  zCupFechLunes: boolean;
  zCupFechMartes: boolean;
  zCupFechMircoles: boolean;
  zCupFechIJueves: boolean;
  zCupFechViernes: boolean;
  zCupFechSbado: boolean;
  zCupFechDomingo: boolean;
}

export interface CupoPorAreaRoot {
  zCantidadProgramada: number;
  zCantidadPlanificada: number;
  zCantidadDisponible: number;
  zIdRegistro: string;
}

export interface CupoPorAreaConFecha {
  zCantidadDisponible: number;
  zIdEmpresa: string;
  /** Formato "YYYY-MM-DDT00:00:00" tal como lo devuelve C4C (OData v2 datetime sin offset). */
  zFecha: string;
}

export interface FechasDisponiblesInput {
  productIds: string[];
  postalCode: string;
  regionCode: string;
  /** ISO date (YYYY-MM-DD), inclusive. */
  desde: string;
  /** ISO date (YYYY-MM-DD), inclusive. */
  hasta: string;
}
