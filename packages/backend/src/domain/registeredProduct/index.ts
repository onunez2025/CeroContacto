import type { IC4CODataClient } from "@cerocontacto/c4c-client";
import { eq } from "@cerocontacto/c4c-client";
import { PERU_DISTRITOS } from "@cerocontacto/shared";
import type { RegisteredProductInput, RegisteredProductRecord, RegisteredProductResult } from "./types.js";

export * from "./types.js";

const NS = "v1/c4codataapi";

/**
 * Modulo Producto Registrado (comun a los 4 casos de cliente):
 * 2.1 Consulta por zaIDdeSerieFSM_KUT -> si hay resultado, ya existe.
 * 2.2 Si no hay resultado: crear el producto registrado y asociarlo al cliente.
 *
 * Riesgo conocido (confirmado con datos reales de C4C QA): el campo
 * zaIDdeSerieFSM_KUT esta poblado de forma inconsistente en la practica -
 * a veces vacio, a veces con texto que no es un serial real. Este "GET
 * antes de crear" puede no encontrar coincidencias reales (crea
 * duplicados) o no aplica si el dato de origen es basura. Ver seccion B
 * del cuestionario tecnico.
 */
export async function resolveRegisteredProduct(
  input: RegisteredProductInput,
  client: IC4CODataClient,
): Promise<RegisteredProductResult> {
  const filter = eq("zaIDdeSerieFSM_KUT", input.numeroSerie);
  const matches = await client.getCollection<RegisteredProductRecord>(
    `${NS}/RegisteredProductCollection?$filter=${encodeURIComponent(filter)}`,
  );

  const existing = matches[0];
  if (existing) {
    return { installationPointId: existing.ID, objectId: existing.ObjectID, wasCreated: false };
  }

  const created = await client.postEntity<RegisteredProductRecord>(`${NS}/RegisteredProductCollection`, {
    SerialID: "",
    zaIDdeSerieFSM_KUT: input.numeroSerie,
    ProductID: input.productId,
    RegisteredProductCategory: "1",
    Status: "2",
    ...(input.lugarCompraId ? { zID_IP_LugarCompra_SDK: input.lugarCompraId } : {}),
    ...(input.warrantyId ? { WarrantyID: input.warrantyId } : {}),
    Country: "PE",
    State: input.direccion.departamento,
    District: PERU_DISTRITOS.find((d) => d.id === input.direccion.distrito)?.nombre ?? "",
    zIPointIDProvinciacontent_SDK: input.direccion.provincia,
    zIPointIDDistritocontent_SDK: input.direccion.distrito,
    House: input.direccion.numero,
    Street: input.direccion.direccion,
    AddressLine5: input.direccion.referencia,
    Z_ReferenciaAdicional_KUT: input.direccion.referenciaAdicional ?? "",
    PostalCode: input.direccion.codigoPostal,
    TimeZoneCode: "UTC-5",
    Floor: input.direccion.piso ?? "",
    RegisteredProductPartyInformation: [{ RoleCode: "60", PartyID: input.buyerPartyId }],
  });

  return { installationPointId: created.ID, objectId: created.ObjectID, wasCreated: true };
}
