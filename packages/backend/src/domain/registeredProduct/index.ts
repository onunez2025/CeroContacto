import type { IC4CODataClient } from "@cerocontacto/c4c-client";
import { eq } from "@cerocontacto/c4c-client";
import { PERU_DISTRITOS } from "@cerocontacto/shared";
import type { RegisteredProductInput, RegisteredProductRecord, RegisteredProductResult } from "./types.js";

export * from "./types.js";

const NS = "v1/c4codataapi";

/** CategoryCode "2"=Documento, TypeCode "10011"=Product Image - confirmados via value-help de C4C. */
const PHOTO_CATEGORY_CODE = "2";
const PHOTO_TYPE_CODE = "10011";

function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    throw new Error("Foto con formato de data URL invalido");
  }
  return { mimeType: match[1] as string, base64: match[2] as string };
}

/**
 * Sube cada foto como RegisteredProductAttachmentFolder ligado al
 * producto registrado (RegisteredProductID es un campo plano, no hace
 * falta anidar bajo RegisteredProductCollection('...')/...).
 */
async function uploadFotos(registeredProductId: string, fotos: string[], client: IC4CODataClient): Promise<void> {
  for (const [index, foto] of fotos.entries()) {
    const { mimeType, base64 } = parseDataUrl(foto);
    await client.postEntity(`${NS}/RegisteredProductAttachmentFolderCollection`, {
      RegisteredProductID: registeredProductId,
      CategoryCode: PHOTO_CATEGORY_CODE,
      TypeCode: PHOTO_TYPE_CODE,
      MimeType: mimeType,
      Name: `foto-${index + 1}.jpg`,
      Binary: base64,
    });
  }
}

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
 *
 * numeroSerie es opcional en el formulario: sin el, no hay forma segura de
 * buscar un producto ya registrado (un filtro por serie vacia matchearia
 * cualquier otro producto con el mismo campo en blanco), asi que se
 * salta la busqueda y siempre se crea un RegisteredProduct nuevo.
 */
export async function resolveRegisteredProduct(
  input: RegisteredProductInput,
  client: IC4CODataClient,
): Promise<RegisteredProductResult> {
  const existing = input.numeroSerie
    ? (
        await client.getCollection<RegisteredProductRecord>(
          `${NS}/RegisteredProductCollection?$filter=${encodeURIComponent(eq("zaIDdeSerieFSM_KUT", input.numeroSerie))}`,
        )
      )[0]
    : undefined;

  if (existing) {
    if (input.fotos?.length) {
      await uploadFotos(existing.ID, input.fotos, client);
    }
    return { installationPointId: existing.ID, objectId: existing.ObjectID, wasCreated: false };
  }

  const created = await client.postEntity<RegisteredProductRecord>(`${NS}/RegisteredProductCollection`, {
    SerialID: "",
    zaIDdeSerieFSM_KUT: input.numeroSerie ?? "",
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
    // input.direccion.referenciaAdicional se omite: produccion no tiene zaReferenciaAdicional_KUT
    // en RegisteredProduct (confirmado via $metadata, 2026-07-24); si en el futuro se agrega el
    // campo alla, se puede reintroducir aqui.
    PostalCode: input.direccion.codigoPostal,
    TimeZoneCode: "UTC-5",
    Floor: input.direccion.piso ?? "",
    RegisteredProductPartyInformation: [{ RoleCode: "60", PartyID: input.buyerPartyId }],
  });

  if (input.fotos?.length) {
    await uploadFotos(created.ID, input.fotos, client);
  }

  return { installationPointId: created.ID, objectId: created.ObjectID, wasCreated: true };
}
