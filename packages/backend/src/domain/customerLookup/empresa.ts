import type { IC4CODataClient } from "@cerocontacto/c4c-client";
import { and, eq } from "@cerocontacto/c4c-client";
import { buildDireccion } from "./address.js";
import type { AddressSubRecord, CorporateAccountLookupRecord, CustomerLookupResult, TaxNumberLookupRecord } from "./types.js";

const NS = "v1/c4codataapi";

/**
 * Busqueda de solo lectura por RUC - a diferencia de
 * customerResolution/empresa.ts, NUNCA crea una cuenta si no la encuentra.
 */
export async function lookupEmpresa(numeroDocumento: string, client: IC4CODataClient): Promise<CustomerLookupResult> {
  const filter = and(eq("TaxID", numeroDocumento), eq("TaxTypeCode", "1"), eq("CountryCode", "PE"));
  const taxMatches = await client.getCollection<TaxNumberLookupRecord>(
    `${NS}/CorporateAccountTaxNumberCollection?$filter=${encodeURIComponent(filter)}`,
  );

  const taxMatch = taxMatches[0];
  if (!taxMatch) return { found: false };

  const accounts = await client.getCollection<CorporateAccountLookupRecord>(
    `${NS}/CorporateAccountCollection?$filter=${encodeURIComponent(eq("AccountID", taxMatch.AccountID ?? ""))}`,
  );
  const account = accounts[0];
  if (!account) return { found: false };

  const addresses = await client.getCollection<AddressSubRecord>(
    `${NS}/CorporateAccountCollection('${taxMatch.ParentObjectID}')/CorporateAccountAddress`,
  );

  return {
    found: true,
    datos: {
      ...(account.Name ? { razonSocial: account.Name } : {}),
      telefono: account.Phone ?? "",
      email: account.Email ?? "",
      direccion: buildDireccion(addresses[0]),
    },
  };
}
