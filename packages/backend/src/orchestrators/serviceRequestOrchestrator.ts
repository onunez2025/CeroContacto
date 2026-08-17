import { C4CError, type IC4CODataClient } from "@cerocontacto/c4c-client";
import type { ServiceRequestSubmission } from "@cerocontacto/shared";
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
      email: submission.email,
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
    email: submission.email,
    direccion: submission.direccion,
  };
}

const MEDIO_CONTACTO_LABELS: Record<ServiceRequestSubmission["medioContacto"], string> = {
  whatsapp: "WhatsApp",
  email: "Email",
  celular: "Celular",
};

/**
 * Datos de contacto tal como los dejo el cliente en ESTA solicitud.
 *
 * El ticket ya apunta al cliente por BuyerPartyID, asi que la correccion
 * que customerResolution escribe en el maestro (nombre/telefono/correo) se
 * ve reflejada al abrir el ticket. Pero el ServiceRequest no guarda copia
 * propia de esos campos, y el asesor que atiende no tiene forma de saber
 * con que datos se registro esta solicitud en particular - por eso van
 * tambien en el texto del ticket (observacion 21 del usuario).
 */
function buildDatosContacto(submission: ServiceRequestSubmission): string {
  const nombre =
    submission.tipoDocumento === "RUC"
      ? submission.razonSocial
      : `${submission.nombres} ${submission.apellidos}`;
  const telefonos = [submission.telefono, submission.telefono2].filter(Boolean).join(" / ");
  return [`Contacto: ${nombre.trim()}`, `Telefono: ${telefonos}`, `Correo: ${submission.email}`].join("\n");
}

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
  return [submission.comentario?.trim(), buildDatosContacto(submission), medio, lugarCompra]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Orquesta el flujo completo de un envio del formulario: resolucion de
 * cliente (4 casos) -> producto registrado -> creacion de ticket. Funcion
 * pura de TypeScript, sin dependencia de Azure Functions/Durable - el
 * wiring a un orquestador Durable (checkpointing, reintentos por
 * actividad) se hace en la capa de Azure Functions, envolviendo esta
 * misma funcion como actividad(es).
 *
 * El motor de cupos (packages/backend/src/domain/cuposEngine) esta
 * deshabilitado aca temporalmente: produccion todavia no tiene
 * desplegados los servicios custom que necesita ("cupoporarea" y
 * "cust_producto" - confirmado en vivo el 2026-07-24, ambos responden
 * "No implementation for service"). El ticket se crea sin
 * contratista/region asignados automaticamente; el asesor los asigna
 * manualmente en C4C despues, igual que hace hoy sin este formulario.
 * Reactivar llamando a assignCupo en cuanto C4C transporte esos servicios
 * a produccion (ver docs/superpowers/specs del feature de fechas
 * disponibles para el detalle completo).
 */
export async function runServiceRequestOrchestration(
  submission: ServiceRequestSubmission,
  client: IC4CODataClient,
): Promise<OrchestrationResult> {
  try {
    const customer = await resolveCustomer(toCustomerResolutionInput(submission), client);

    // Un producto registrado por item de la solicitud (combo cocina+horno+
    // campana = 3 productos registrados), todos asociados al mismo cliente.
    // Se acumulan los ObjectID ya resueltos en este envio y se excluyen de
    // la busqueda del siguiente item: dos filas del mismo modelo en un
    // combo son dos unidades fisicas distintas, aunque compartan dueño,
    // modelo, direccion y (si viene vacia) serie.
    const products = [];
    const objectIdsUsados: string[] = [];
    for (const producto of submission.productos) {
      const product = await resolveRegisteredProduct(
        {
          numeroSerie: producto.numeroSerie,
          productId: producto.productId,
          buyerPartyId: customer.buyerPartyId,
          direccion: submission.direccion,
          fotos: producto.fotos,
          excluirObjectIds: objectIdsUsados,
        },
        client,
      );
      objectIdsUsados.push(product.objectId);
      products.push({ productId: producto.productId, ...product });
    }

    // Un Service Request por producto. Sin motor de cupos, todos quedan sin
    // contratista/region asignados automaticamente (ver nota arriba).
    const comentarioParaC4C = buildComentarioParaC4C(submission);
    const ticketIds: string[] = [];
    const productosFallidos: string[] = [];
    let primerErrorDeNegocio: string | undefined;

    for (const product of products) {
      try {
        const ticket = await createTicket(
          {
            buyerPartyId: customer.buyerPartyId,
            productId: product.productId,
            installationPointId: product.installationPointId,
            fechaVisita: submission.fechaVisita,
            provincia: submission.direccion.provincia,
            distrito: submission.direccion.distrito,
            comentario: comentarioParaC4C,
          },
          client,
        );
        ticketIds.push(ticket.ticketId);
      } catch (err) {
        // Solo las reglas de negocio se capturan por producto. Un fallo de
        // conectividad (5xx/timeout) se propaga y aborta todo, porque ahi
        // reintentar la solicitud completa si tiene sentido.
        if (!(err instanceof C4CError && err.isBusinessRuleFailure)) throw err;
        productosFallidos.push(product.productId);
        primerErrorDeNegocio ??= err.businessMessage ?? "error de validacion en SAP.";
      }
    }

    if (productosFallidos.length === 0) {
      return { status: "Completed", ticketIds };
    }

    const errorMessage = `No pudimos completar tu solicitud: ${primerErrorDeNegocio}`;
    // Sin ningun ticket creado es un fallo total, igual que antes de este
    // cambio. Con algunos creados, informar el resultado real: reenviar el
    // formulario duplicaria los tickets que si existen.
    if (ticketIds.length === 0) {
      return { status: "Failed", errorMessage };
    }
    return { status: "Partial", ticketIds, productosFallidos, errorMessage };
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
