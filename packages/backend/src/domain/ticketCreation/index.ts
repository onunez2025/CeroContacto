import type { IC4CODataClient } from "@cerocontacto/c4c-client";
import { SERVICE_AREA_ID, SERVICE_TYPE_ID } from "../cuposEngine/types.js";
import type { ServiceRequestRecord, TicketCreationInput, TicketCreationResult } from "./types.js";

export * from "./types.js";

const NS = "v1/c4codataapi";

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
    // No se envia "Name": los tickets organicos reales en C4C (creados por
    // el proceso actual, ej. IDs 138388-138392) siempre tienen Name como
    // timestamp ("2026-07-06T23:27:31") - eso es el default de C4C cuando
    // el campo no se envia, no un valor puesto por el creador del ticket.
    ProcessingTypeCode: "SRRQ",
    ServicePriorityCode: "3",
    DataOriginTypeCode: "1",
    BuyerPartyID: input.buyerPartyId,
    ProductID: input.productId,
    InstallationPointID: input.installationPointId,
    ServiceIssueCategoryID: input.serviceIssueCategoryId ?? SERVICE_TYPE_ID,
    Z_CabRegion_KUT: input.cabRegion,
    zTicketArea_SDK: SERVICE_AREA_ID,
    zIDEmpresa_SDK: input.companyId,
    RequestInitialReceiptdatetimeZoneCode: "UTC-5",
    RequestInitialReceiptdatetimecontent: input.fechaVisita,
    zaRegionFSM_ID_KUT: input.regionFsmId,
    zaRegionFSM_KUT: input.regionFsm,
    zIDRegistroCupoArea_SDK: input.reservationId,
    ServiceRequestItem: [DEFAULT_SERVICE_ITEM],
  });

  if (input.comentario?.trim()) {
    await client.postEntity(`${NS}/ServiceRequestCollection('${created.ObjectID}')/ServiceRequestTextCollection`, {
      TypeCode: CASE_DESCRIPTION_TYPE_CODE,
      Text: input.comentario.trim(),
    });
  }

  return { ticketObjectId: created.ObjectID, ticketId: created.ID };
}
