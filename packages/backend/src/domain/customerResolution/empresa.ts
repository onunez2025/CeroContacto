import type { IC4CODataClient } from "@cerocontacto/c4c-client";
import { and, eq } from "@cerocontacto/c4c-client";
import { syncContactFields } from "./contactSync.js";
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
    return resolveExistingEmpresa(existing, input, client);
  }

  return createEmpresa(input, client);
}

/**
 * Algunas cuentas ya existentes en C4C (migradas de sistemas previos) no
 * tienen StateCode/StreetPostalCode registrados. En vez de fallar toda la
 * solicitud, se les agrega la direccion recien ingresada por el cliente -
 * mismo POST de CorporateAccountAddress que usa createEmpresa para una
 * cuenta nueva.
 *
 * Ademas de la direccion, se sincronizan razon social/telefono/correo si
 * el cliente los corrigio en el formulario (observacion 21 del usuario).
 */
async function resolveExistingEmpresa(
  taxMatch: CorporateAccountTaxNumber,
  input: EmpresaInput,
  client: IC4CODataClient,
): Promise<CustomerResolutionResult> {
  const filter = eq("AccountID", taxMatch.AccountID);
  const accounts = await client.getCollection<CorporateAccount>(
    `${NS}/CorporateAccountCollection?$filter=${encodeURIComponent(filter)}`,
  );
  const account = accounts[0];

  await syncContactFields(
    `${NS}/CorporateAccountCollection('${taxMatch.ParentObjectID}')`,
    {
      Name: account?.Name ?? "",
      Phone: account?.Phone ?? "",
      Mobile: account?.Mobile ?? "",
      Email: account?.Email ?? "",
    },
    {
      Name: input.razonSocial,
      // Los telefonos van CRUZADOS respecto a lo que sugiere el nombre del
      // campo: en la pantalla de C4C, `Mobile` se muestra como "Celular 1" y
      // `Phone` como "Celular 2" (confirmado el 2026-08-18 comparando el
      // ticket 886671 contra los valores reales del cliente 1306546). La
      // linea 1 del formulario es el telefono principal, asi que va a
      // Celular 1 = Mobile. Antes iba a Phone y aparecia en Celular 2.
      Mobile: input.telefono,
      Phone: input.telefono2 ?? "",
      Email: input.email,
    },
    client,
  );

  if (account?.StateCode && account?.StreetPostalCode) {
    return {
      clientKind: "empresa",
      buyerPartyId: taxMatch.AccountID,
      clienteObjectId: taxMatch.ParentObjectID,
      wasCreated: false,
      regionCode: account.StateCode,
      postalCode: account.StreetPostalCode,
    };
  }

  await client.postEntity(`${NS}/CorporateAccountCollection('${taxMatch.ParentObjectID}')/CorporateAccountAddress`, {
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
    buyerPartyId: taxMatch.AccountID,
    clienteObjectId: taxMatch.ParentObjectID,
    wasCreated: false,
    regionCode: input.direccion.departamento,
    postalCode: input.direccion.codigoPostal,
  };
}

async function createEmpresa(input: EmpresaInput, client: IC4CODataClient): Promise<CustomerResolutionResult> {
  const created = await client.postEntity<CorporateAccount>(`${NS}/CorporateAccountCollection`, {
    RoleCode: "CRM000",
    Name: input.razonSocial,
    // Los telefonos van CRUZADOS respecto a lo que sugiere el nombre del
    // campo: en la pantalla de C4C, `Mobile` se muestra como "Celular 1" y
    // `Phone` como "Celular 2" (confirmado el 2026-08-18 comparando el
    // ticket 886671 contra los valores reales del cliente 1306546). La
    // linea 1 del formulario es el telefono principal, asi que va a
    // Celular 1 = Mobile. Antes iba a Phone y aparecia en Celular 2.
    Mobile: input.telefono,
    Phone: input.telefono2 ?? "",
    Email: input.email,
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
