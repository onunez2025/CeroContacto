import { formatearCoordenada } from "../coordenadas.js";
import type { IC4CODataClient } from "@cerocontacto/c4c-client";
import { and, eq } from "@cerocontacto/c4c-client";
import { PERU_DISTRITOS } from "@cerocontacto/shared";
import type {
  RegisteredProductInput,
  RegisteredProductPartyRecord,
  RegisteredProductRecord,
  RegisteredProductResult,
} from "./types.js";

export * from "./types.js";

const NS = "v1/c4codataapi";

/** CategoryCode "2"=Documento, TypeCode "10011"=Product Image - confirmados via value-help de C4C. */
const PHOTO_CATEGORY_CODE = "2";
const PHOTO_TYPE_CODE = "10011";

/** RoleCode del propietario del producto registrado. */
const OWNER_ROLE_CODE = "60";

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
 * Busca un producto registrado que represente EL MISMO equipo fisico que el
 * que se esta registrando: mismo dueño, mismo modelo y misma direccion de
 * instalacion.
 *
 * La serie NO se usa como criterio de busqueda. Hacerlo era un bug real
 * confirmado en produccion (2026-08-10): "zaIDdeSerieFSM_KUT eq '123'"
 * matchea mas de 10 equipos de modelos y dueños distintos, y el ticket
 * terminaba apuntando al equipo de otra persona. La serie solo desempata
 * entre candidatos que ya pasaron el filtro de dueño+modelo+direccion.
 *
 * Como efecto secundario buscado, esto tambien corta los duplicados por
 * reintento: si el ticket fallo pero el producto quedo creado, el siguiente
 * intento lo encuentra y lo reutiliza en vez de crear otro.
 */
async function findReusableProduct(
  input: RegisteredProductInput,
  client: IC4CODataClient,
): Promise<RegisteredProductRecord | undefined> {
  const filter = and(
    eq("ProductID", input.productId),
    eq("Street", input.direccion.direccion),
    eq("PostalCode", input.direccion.codigoPostal),
    eq("House", input.direccion.numero),
  );
  const candidates = await client.getCollection<RegisteredProductRecord>(
    `${NS}/RegisteredProductCollection?$filter=${encodeURIComponent(filter)}&$select=ObjectID,ID,zaIDdeSerieFSM_KUT`,
  );
  if (candidates.length === 0) return undefined;

  const partyFilter = and(eq("PartyID", input.buyerPartyId), eq("RoleCode", OWNER_ROLE_CODE));
  const ownerRows = await client.getCollection<RegisteredProductPartyRecord>(
    `${NS}/RegisteredProductPartyInformationCollection?$filter=${encodeURIComponent(partyFilter)}&$select=ParentObjectID`,
  );
  const ownedIds = new Set(ownerRows.map((row) => row.ParentObjectID));
  const excluidos = new Set(input.excluirObjectIds ?? []);

  const serie = input.numeroSerie?.trim() ?? "";
  // Un candidato es incompatible solo si AMBAS series estan presentes y
  // difieren: eso prueba que son unidades fisicas distintas. Cualquier otra
  // combinacion (alguna vacia, o iguales) se considera el mismo equipo.
  const compatibles = candidates.filter((candidate) => {
    // Ya consumido por otro item de este mismo envio: aunque coincida en
    // dueño+modelo+direccion+serie, es una unidad fisica distinta (ver
    // comentario de excluirObjectIds en types.ts). Se descarta antes de
    // cualquier otra comprobacion de compatibilidad.
    if (excluidos.has(candidate.ObjectID)) return false;
    if (!ownedIds.has(candidate.ObjectID)) return false;
    const candidateSerie = candidate.zaIDdeSerieFSM_KUT?.trim() ?? "";
    return serie === "" || candidateSerie === "" || serie === candidateSerie;
  });

  const exacto = compatibles.find(
    (candidate) => serie !== "" && (candidate.zaIDdeSerieFSM_KUT?.trim() ?? "") === serie,
  );
  return exacto ?? compatibles[0];
}

/**
 * Modulo Producto Registrado (comun a los 4 casos de cliente): reutiliza el
 * producto si ya existe uno del mismo dueño, modelo y direccion (ver
 * findReusableProduct); si no, lo crea y lo asocia al cliente.
 */
export async function resolveRegisteredProduct(
  input: RegisteredProductInput,
  client: IC4CODataClient,
): Promise<RegisteredProductResult> {
  const existing = await findReusableProduct(input, client);

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
    // Coordenadas del mapa. Son los campos que consume Field Service
    // Management para que el tecnico ubique la casa; C4C los guarda como
    // texto, con el punto como separador decimal.
    zaLatitudFSM_KUT: formatearCoordenada(input.direccion.latitud),
    zaLongitudFSM_KUT: formatearCoordenada(input.direccion.longitud),
    TimeZoneCode: "UTC-5",
    Floor: input.direccion.piso ?? "",
    RegisteredProductPartyInformation: [{ RoleCode: OWNER_ROLE_CODE, PartyID: input.buyerPartyId }],
  });

  if (input.fotos?.length) {
    await uploadFotos(created.ID, input.fotos, client);
  }

  return { installationPointId: created.ID, objectId: created.ObjectID, wasCreated: true };
}
