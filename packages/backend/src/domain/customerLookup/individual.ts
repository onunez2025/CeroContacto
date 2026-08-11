import type { IC4CODataClient } from "@cerocontacto/c4c-client";
import { and, eq } from "@cerocontacto/c4c-client";
import { INDIVIDUAL_TAX_TYPE_CODE } from "../customerResolution/types.js";
import { buildDireccion } from "./address.js";
import type {
  AddressSubRecord,
  CustomerLookupResult,
  IndividualCustomerLookupRecord,
  TaxNumberLookupRecord,
} from "./types.js";

const NS = "v1/c4codataapi";

/**
 * Busqueda de solo lectura por documento (DNI/CE) - a diferencia de
 * customerResolution/individual.ts, NUNCA crea un cliente si no lo
 * encuentra. Pensada para autocompletar el formulario en el evento
 * `blur` del campo de documento, antes de que el cliente termine de
 * llenar el resto de los datos.
 */
export async function lookupIndividual(
  tipoDocumento: "DNI" | "CE",
  numeroDocumento: string,
  client: IC4CODataClient,
): Promise<CustomerLookupResult> {
  const taxTypeCode = INDIVIDUAL_TAX_TYPE_CODE[tipoDocumento];
  const filter = and(eq("TaxID", numeroDocumento), eq("TaxTypeCode", taxTypeCode), eq("CountryCode", "PE"));
  const taxMatches = await client.getCollection<TaxNumberLookupRecord>(
    `${NS}/IndividualCustomerTaxNumberCollection?$filter=${encodeURIComponent(filter)}`,
  );

  const taxMatch = taxMatches[0];
  if (!taxMatch) return { found: false };

  const customers = await client.getCollection<IndividualCustomerLookupRecord>(
    `${NS}/IndividualCustomerCollection?$filter=${encodeURIComponent(eq("CustomerID", taxMatch.CustomerID ?? ""))}`,
  );
  const customer = customers[0];
  if (!customer) return { found: false };

  const addresses = await client.getCollection<AddressSubRecord>(
    `${NS}/IndividualCustomerCollection('${taxMatch.ParentObjectID}')/IndividualCustomerAddress`,
  );

  return {
    found: true,
    datos: {
      ...(customer.FirstName ? { nombres: customer.FirstName } : {}),
      ...(customer.LastName ? { apellidos: customer.LastName } : {}),
      // Phone primero, Mobile como respaldo: ver la nota de Mobile en types.ts.
      telefono: customer.Phone?.trim() || customer.Mobile?.trim() || "",
      email: customer.Email ?? "",
      direccion: buildDireccion(addresses[0]),
    },
  };
}
