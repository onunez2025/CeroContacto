import type { IC4CODataClient } from "@cerocontacto/c4c-client";
import { SERVICE_AREA_ID, SERVICE_TYPE_ID } from "../cuposEngine/types.js";
import type { ServiceRequestRecord, TicketCreationInput, TicketCreationResult } from "./types.js";

export * from "./types.js";

const NS = "v1/c4codataapi";

/** Lima (America/Lima) es UTC-5 todo el ano, sin horario de verano. */
const LIMA_OFFSET_MS = 5 * 60 * 60 * 1000;

/**
 * Timestamp local de Lima en el mismo formato que C4C usa por default para
 * "Name" cuando el campo no se envia (ej. "2026-07-06T23:27:31") - pero ese
 * default de C4C usa la hora del servidor (UTC), no la hora de Lima. Se
 * calcula restando el offset y formateando como si fuera UTC, para producir
 * el mismo patron de string pero con la hora local correcta.
 */
function limaTimestampName(): string {
  return new Date(Date.now() - LIMA_OFFSET_MS).toISOString().slice(0, 19);
}

/** TypeCode de ServiceRequestTextCollection para el comentario del cliente
 * ("Descripcion" en Fiori, distinto de "Descripcion del trabajo"=10071) -
 * confirmado en vivo contra QA (ticket 138374). */
const CASE_DESCRIPTION_TYPE_CODE = "10004";

/**
 * Item de servicio con valores por defecto tomados del ejemplo del
 * proveedor (Postman). zItemIDCentro_SDK/zItemIDAlmacencontent_SDK/
 * ZaMotivo_KUT parecen configuracion fija de back-office, no datos que
 * vengan del formulario - asumido hasta que el negocio confirme si varian
 * por contratista/almacen.
 */
const DEFAULT_SERVICE_ITEM = {
  ID: "10",
  UserServiceTransactionProcessingTypeCode: "Z001",
  ProductID: "REPARAR",
  DescriptionLanguageCode: "ES",
  ServiceRequestExecutionLifeCycleStatusCode: "6",
  PlannedQuantity: "0.41700000000000",
  ActualQuantity: "0.00000000000000",
  zItemIDCentro_SDK: "M310 ",
  zItemIDAlmacencontent_SDK: "0171",
  ZaMotivoNoCobro_KUT: "",
  ZaMotivo_KUT: "103",
};

/**
 * Paso final: POST ServiceRequestCollection. El payload es el mismo para
 * Empresa/Individual - solo cambia el origen de `buyerPartyId`, ya
 * resuelto por customerResolution antes de llegar aqui.
 */
export async function createTicket(
  input: TicketCreationInput,
  client: IC4CODataClient,
): Promise<TicketCreationResult> {
  const created = await client.postEntity<ServiceRequestRecord>(`${NS}/ServiceRequestCollection`, {
    // Se envia "Name" explicitamente en hora local de Lima: el default de
    // C4C cuando el campo no se envia es tambien un timestamp (ver tickets
    // organicos, ej. IDs 138388-138392), pero calculado en la zona horaria
    // del servidor, no en UTC-5 - lo cual mostraba una hora incorrecta al
    // negocio (confirmado en el ticket real 1399562, 2026-07-30).
    Name: limaTimestampName(),
    ProcessingTypeCode: "SRRQ",
    ServicePriorityCode: "3",
    DataOriginTypeCode: "1",
    BuyerPartyID: input.buyerPartyId,
    ProductID: input.productId,
    InstallationPointID: input.installationPointId,
    ServiceIssueCategoryID: input.serviceIssueCategoryId ?? SERVICE_TYPE_ID,
    zTicketArea_SDK: SERVICE_AREA_ID,
    RequestInitialReceiptdatetimeZoneCode: "UTC-5",
    RequestInitialReceiptdatetimecontent: input.fechaVisita,
    zTicketIDProvinciacontent_SDK: input.provincia,
    zTicketIDDistritocontent_SDK: input.distrito,
    // Campos del contratista/region asignados por el motor de cupos - se
    // omiten por completo (no se envian ni vacios) mientras ese motor este
    // deshabilitado, ver nota en TicketCreationInput. zaRegionFSM_ID_KUT en
    // particular ni siquiera existe en el customizing de produccion todavia.
    ...(input.cabRegion ? { Z_CabRegion_KUT: input.cabRegion } : {}),
    ...(input.companyId ? { zIDEmpresa_SDK: input.companyId } : {}),
    ...(input.regionFsmId ? { zaRegionFSM_ID_KUT: input.regionFsmId } : {}),
    ...(input.regionFsm ? { zaRegionFSM_KUT: input.regionFsm } : {}),
    ...(input.reservationId ? { zIDRegistroCupoArea_SDK: input.reservationId } : {}),
    ServiceRequestItem: [DEFAULT_SERVICE_ITEM],
  });

  // "Listo para planificar" se aplica con un PATCH DESPUES de crear, no en
  // el POST inicial: confirmado en vivo (2026-08-03) que enviarlo dentro
  // del POST produce un 500 real de C4C ("Inconsistencia en gestion de
  // estados entre estado de sistema y estado") - el estado de sistema
  // (ServiceRequestLifeCycleStatusCode, no controlado por nosotros)
  // arranca en un valor que no es compatible con este estado de usuario
  // en el momento de la creacion. La transicion via PATCH sobre un ticket
  // ya creado si funciona (confirmado en el ticket real 1399562). Si el
  // PATCH falla, no se aborta la creacion - el ticket ya existe y es
  // usable (el asesor lo cambia de estado manualmente, como se hacia
  // antes de este cambio), solo se pierde la conveniencia del estado
  // inicial automatico.
  try {
    await client.patch(`${NS}/ServiceRequestCollection('${created.ObjectID}')`, {
      ServiceRequestUserLifeCycleStatusCode: "7",
    });
  } catch (err) {
    console.warn("ticket_status_patch_failed", { ticketObjectId: created.ObjectID, err });
  }

  if (input.comentario?.trim()) {
    await client.postEntity(`${NS}/ServiceRequestCollection('${created.ObjectID}')/ServiceRequestTextCollection`, {
      TypeCode: CASE_DESCRIPTION_TYPE_CODE,
      Text: input.comentario.trim(),
    });
  }

  return { ticketObjectId: created.ObjectID, ticketId: created.ID };
}
