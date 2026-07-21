import type { IC4CODataClient } from "@cerocontacto/c4c-client";
import { and, eq } from "@cerocontacto/c4c-client";
import type { CorporateAccount, CorporateAccountTaxNumber, CustomerResolutionResult, EmpresaInput } from "./types.js";

const NS = "v1/c4codataapi";

/**
 * Caso 1 (no existe) / Caso 2 (ya existe) del documento tecnico, unificados:
 * 1.1 Consulta por TaxID (RUC) -> si hay resultado, Caso 2 (existente).
 * 1.2 Si no hay resultado: crear cuenta + direccion (Caso 1, nuevo).
 */
export async function resolveEmpresa(
  input: EmpresaInput,
  client: IC4CODataClient,
): Promise<CustomerResolutionResult> {
  const filter = and(eq("TaxID", input.numeroDocumento), eq("TaxTypeCode", "1"), eq("CountryCode", "PE"));
  const taxMatches = await client.getCollection<CorporateAccountTaxNumber>(
    `${NS}/CorporateAccountTaxNumberCollection?$filter=${encodeURIComponent(filter)}`,
  );

  const existing = taxMatches[0];
  if (existing) {
    return resolveExistingEmpresa(existing, client);
  }

  return createEmpresa(input, client);
}

async function resolveExistingEmpresa(
  taxMatch: CorporateAccountTaxNumber,
  client: IC4CODataClient,
): Promise<CustomerResolutionResult> {
  const filter = eq("AccountID", taxMatch.AccountID);
  const accounts = await client.getCollection<CorporateAccount>(
    `${NS}/CorporateAccountCollection?$filter=${encodeURIComponent(filter)}`,
  );
  const account = accounts[0];
  if (!account?.StateCode || !account?.StreetPostalCode) {
    throw new Error(
      `CorporateAccount ${taxMatch.AccountID} existe pero no tiene StateCode/StreetPostalCode registrados en C4C`,
    );
  }

  return {
    clientKind: "empresa",
    buyerPartyId: taxMatch.AccountID,
    clienteObjectId: taxMatch.ParentObjectID,
    wasCreated: false,
    regionCode: account.StateCode,
    postalCode: account.StreetPostalCode,
  };
}

async function createEmpresa(input: EmpresaInput, client: IC4CODataClient): Promise<CustomerResolutionResult> {
  const created = await client.postEntity<CorporateAccount>(`${NS}/CorporateAccountCollection`, {
    RoleCode: "CRM000",
    Name: input.razonSocial,
    Phone: input.telefono,
    Mobile: input.telefono2 ?? "",
    LanguageCode: "ES",
    SalesSupportBlockingIndicator: false,
    LegalCompetenceIndicator: true,
    zaGrupoDeCuenta_KUT: "Z001",
    CorporateAccountTaxNumber: [{ CountryCode: "PE", TaxTypeCode: "1", TaxID: input.numeroDocumento }],
  });

  await client.postEntity(`${NS}/CorporateAccountCollection('${created.ObjectID}')/CorporateAccountAddress`, {
    CountryCode: "PE",
    StateCode: input.direccion.departamento,
    zIDProvinciacontent_SDK: input.direccion.provincia,
    zIDDistritocontent_SDK: input.direccion.distrito,
    HouseNumber: input.direccion.numero,
    Street: input.direccion.direccion,
    AddressLine5: input.direccion.referencia,
    zaReferenciaAdicional_KUT: input.direccion.referenciaAdicional ?? "",
    StreetPostalCode: input.direccion.codigoPostal,
    TimeZoneCode: "UTC-5",
    Floor: input.direccion.piso ?? "",
  });

  return {
    clientKind: "empresa",
    buyerPartyId: created.AccountID,
    clienteObjectId: created.ObjectID,
    wasCreated: true,
    regionCode: input.direccion.departamento,
    postalCode: input.direccion.codigoPostal,
  };
}
