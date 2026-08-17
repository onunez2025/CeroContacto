import type { IC4CODataClient } from "@cerocontacto/c4c-client";

/**
 * Campos de contacto de un cliente ya existente en C4C, con los nombres
 * tecnicos del BO (IndividualCustomer/CorporateAccount) porque el PATCH va
 * directo contra la coleccion.
 */
export type ContactFields = Record<string, string>;

/**
 * Compara lo que el cliente acaba de escribir en el formulario contra lo
 * que C4C tiene guardado y devuelve SOLO los campos que cambiaron.
 *
 * - Un valor entrante vacio nunca pisa uno existente: `telefono2` es
 *   opcional en el formulario, y no enviarlo significa "no lo toques", no
 *   "borra el Mobile que ya estaba".
 * - Un campo que C4C tiene vacio y ahora llega con dato si se escribe.
 * - Si nada cambio, devuelve un objeto vacio y no hay que hacer PATCH.
 */
export function diffContactFields(actual: ContactFields, entrante: ContactFields): ContactFields {
  const cambios: ContactFields = {};
  for (const [campo, valorEntrante] of Object.entries(entrante)) {
    const nuevo = valorEntrante.trim();
    if (!nuevo) continue;
    if ((actual[campo] ?? "").trim() === nuevo) continue;
    cambios[campo] = nuevo;
  }
  return cambios;
}

/**
 * Actualiza en C4C los datos de contacto de un cliente que ya existia,
 * cuando el cliente los corrigio en el formulario (observacion 21 del
 * usuario: antes se ignoraban por completo y el asesor seguia viendo el
 * nombre, telefono o correo viejo).
 *
 * Si el PATCH falla NO se aborta la solicitud: el ticket todavia se puede
 * crear contra el cliente con sus datos anteriores, y perder la
 * actualizacion del maestro es mucho menos grave que perder la solicitud
 * completa. Mismo criterio que el PATCH de estado en ticketCreation.
 *
 * Devuelve los campos efectivamente escritos (vacio si no hubo cambios o
 * si el PATCH fallo), para que quien llame pueda registrarlo.
 */
export async function syncContactFields(
  entityPath: string,
  actual: ContactFields,
  entrante: ContactFields,
  client: IC4CODataClient,
): Promise<ContactFields> {
  const cambios = diffContactFields(actual, entrante);
  if (Object.keys(cambios).length === 0) return {};

  try {
    await client.patch(entityPath, cambios);
    return cambios;
  } catch (err) {
    console.warn("customer_contact_patch_failed", { entityPath, campos: Object.keys(cambios), err });
    return {};
  }
}
