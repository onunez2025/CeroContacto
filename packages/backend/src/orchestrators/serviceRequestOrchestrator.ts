import { C4CError, type IC4CODataClient } from "@cerocontacto/c4c-client";
import type { ServiceRequestSubmission } from "@cerocontacto/shared";
import { assignCupo, type CuposEngineFailureReason } from "../domain/cuposEngine/index.js";
import { resolveCustomer, type CustomerResolutionInput } from "../domain/customerResolution/index.js";
import { resolveRegisteredProduct } from "../domain/registeredProduct/index.js";
import { createTicket } from "../domain/ticketCreation/index.js";
import type { OrchestrationResult } from "./types.js";

export * from "./types.js";

function toCustomerResolutionInput(submission: ServiceRequestSubmission): CustomerResolutionInput {
  if (submission.tipoDocumento === "RUC") {
    return {
      tipoDocumento: "RUC",
      numeroDocumento: submission.numeroDocumento,
      razonSocial: submission.razonSocial,
      telefono: submission.telefono,
      telefono2: submission.telefono2,
      direccion: submission.direccion,
    };
  }
  return {
    tipoDocumento: submission.tipoDocumento,
    numeroDocumento: submission.numeroDocumento,
    nombres: submission.nombres,
    apellidos: submission.apellidos,
    telefono: submission.telefono,
    telefono2: submission.telefono2,
    direccion: submission.direccion,
  };
}

const MEDIO_CONTACTO_LABELS: Record<ServiceRequestSubmission["medioContacto"], string> = {
  whatsapp: "WhatsApp",
  email: "Email",
  celular: "Celular",
};

/**
 * "Medio de contacto preferido" y "Lugar de compra" todavia no tienen un
 * mapeo confirmado/accesible en C4C (zIDLugarCompra_SDK existe pero
 * _SYSODATA no tiene permiso de lectura sobre el BO "lugardecompra" que
 * traduce codigo->nombre - pedido en curso), asi que ambos se anexan como
 * texto al mismo comentario del cliente (ServiceRequestTextCollection
 * TypeCode "10004") en vez de bloquear o adivinar un codigo.
 */
function buildComentarioParaC4C(submission: ServiceRequestSubmission): string {
  const medio = `Medio de contacto preferido: ${MEDIO_CONTACTO_LABELS[submission.medioContacto]}`;
  const lugarCompra = `Lugar de compra: ${submission.lugarCompra}`;
  return [submission.comentario?.trim(), medio, lugarCompra].filter(Boolean).join("\n\n");
}

const CUPOS_FAILURE_MESSAGES: Record<CuposEngineFailureReason, string> = {
  NO_PRODUCT_GROUP: "No pudimos identificar el modelo de producto indicado. Por favor verifica el codigo e intenta de nuevo.",
  NO_REGION_MATCH: "No encontramos cobertura de servicio para tu codigo postal.",
  NO_CANDIDATE_COMPANY: "No hay contratistas de instalacion disponibles en tu zona por el momento.",
  NO_CAPACITY: "No hay cupos disponibles para la fecha solicitada. Por favor intenta con otra fecha.",
};

/**
 * Orquesta el flujo completo de un envio del formulario: resolucion de
 * cliente (4 casos) -> producto registrado -> motor de cupos -> creacion
 * de ticket. Funcion pura de TypeScript, sin dependencia de Azure
 * Functions/Durable - el wiring a un orquestador Durable (checkpointing,
 * reintentos por actividad) se hace en la capa de Azure Functions,
 * envolviendo esta misma funcion como actividad(es).
 */
export async function runServiceRequestOrchestration(
  submission: ServiceRequestSubmission,
  client: IC4CODataClient,
): Promise<OrchestrationResult> {
  try {
    const customer = await resolveCustomer(toCustomerResolutionInput(submission), client);

    // Un producto registrado por item de la solicitud (combo cocina+horno+
    // campana = 3 productos registrados), todos asociados al mismo cliente.
    const products = [];
    for (const producto of submission.productos) {
      const product = await resolveRegisteredProduct(
        {
          numeroSerie: producto.numeroSerie,
          productId: producto.productId,
          buyerPartyId: customer.buyerPartyId,
          direccion: submission.direccion,
        },
        client,
      );
      products.push({ productId: producto.productId, ...product });
    }

    // El motor de cupos corre UNA sola vez para toda la solicitud: misma
    // visita, mismo contratista/fecha para todos los productos.
    const cupo = await assignCupo(
      {
        productIds: submission.productos.map((p) => p.productId),
        postalCode: customer.postalCode,
        regionCode: customer.regionCode,
        fechaVisita: submission.fechaVisita,
      },
      client,
    );

    if (!cupo.ok) {
      return { status: "Failed", errorMessage: CUPOS_FAILURE_MESSAGES[cupo.reason] };
    }

    // Un Service Request por producto, todos ligados al mismo cupo/contratista.
    const comentarioParaC4C = buildComentarioParaC4C(submission);
    const ticketIds: string[] = [];
    for (const product of products) {
      const ticket = await createTicket(
        {
          buyerPartyId: customer.buyerPartyId,
          productId: product.productId,
          installationPointId: product.installationPointId,
          cabRegion: cupo.cabRegion,
          companyId: cupo.companyId,
          fechaVisita: submission.fechaVisita,
          regionFsmId: cupo.regionFsmId,
          regionFsm: cupo.regionFsm,
          reservationId: cupo.reservationId,
          comentario: comentarioParaC4C,
        },
        client,
      );
      ticketIds.push(ticket.ticketId);
    }

    return { status: "Completed", ticketIds };
  } catch (err) {
    if (err instanceof C4CError && err.isBusinessRuleFailure) {
      return {
        status: "Failed",
        errorMessage: `No pudimos completar tu solicitud: ${err.businessMessage ?? "error de validacion en SAP."}`,
      };
    }
    throw err;
  }
}
