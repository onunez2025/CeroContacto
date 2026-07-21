import type { IC4CODataClient } from "@cerocontacto/c4c-client";
import { and, eq } from "@cerocontacto/c4c-client";
import {
  INDIVIDUAL_TAX_TYPE_CODE,
  type CustomerResolutionResult,
  type IndividualCustomer,
  type IndividualCustomerTaxNumber,
  type IndividualInput,
} from "./types.js";

const NS = "v1/c4codataapi";

/**
 * Caso 3 (no existe) / Caso 4 (ya existe), unificados. Cubre DNI y CE
 * (Carne de Extranjeria) - ambos crean un IndividualCustomer, solo cambia
 * el TaxTypeCode ("2" para DNI, "5" para CE - confirmado via $metadata).
 * 1.1 Consulta por TaxID -> si hay resultado, Caso 4 (existente).
 * 1.2 Si no hay resultado: crear cliente individual + direccion (Caso 3, nuevo).
 */
export async function resolveIndividual(
  input: IndividualInput,
  client: IC4CODataClient,
): Promise<CustomerResolutionResult> {
  const taxTypeCode = INDIVIDUAL_TAX_TYPE_CODE[input.tipoDocumento];
  const filter = and(eq("TaxID", input.numeroDocumento), eq("TaxTypeCode", taxTypeCode), eq("CountryCode", "PE"));
  const taxMatches = await client.getCollection<IndividualCustomerTaxNumber>(
    `${NS}/IndividualCustomerTaxNumberCollection?$filter=${encodeURIComponent(filter)}`,
  );

  const existing = taxMatches[0];
  if (existing) {
    return resolveExistingIndividual(existing, client);
  }

  return createIndividual(input, taxTypeCode, client);
}

async function resolveExistingIndividual(
  taxMatch: IndividualCustomerTaxNumber,
  client: IC4CODataClient,
): Promise<CustomerResolutionResult> {
  const filter = eq("CustomerID", taxMatch.CustomerID);
  const customers = await client.getCollection<IndividualCustomer>(
    `${NS}/IndividualCustomerCollection?$filter=${encodeURIComponent(filter)}`,
  );
  const customer = customers[0];
  if (!customer?.StateCode || !customer?.StreetPostalCode) {
    throw new Error(
      `IndividualCustomer ${taxMatch.CustomerID} existe pero no tiene StateCode/StreetPostalCode registrados en C4C`,
    );
  }

  return {
    clientKind: "individual",
    buyerPartyId: taxMatch.CustomerID,
    clienteObjectId: taxMatch.ParentObjectID,
    wasCreated: false,
    regionCode: customer.StateCode,
    postalCode: customer.StreetPostalCode,
  };
}

async function createIndividual(
  input: IndividualInput,
  taxTypeCode: string,
  client: IC4CODataClient,
): Promise<CustomerResolutionResult> {
  const created = await client.postEntity<IndividualCustomer>(`${NS}/IndividualCustomerCollection`, {
    RoleCode: "CRM000",
    FirstName: input.nombres,
    LastName: input.apellidos,
    Phone: input.telefono,
    Mobile: input.telefono2 ?? "",
    Email: input.email,
    GenderCode: "0",
    SalesSupportBlockingIndicator: false,
    zaGrupoDeCuenta_KUT: "Z001",
    NationalityCountryCode: "PE",
    IndividualCustomerTaxNumber: [{ CountryCode: "PE", TaxTypeCode: taxTypeCode, TaxID: input.numeroDocumento }],
  });

  await client.postEntity(`${NS}/IndividualCustomerCollection('${created.ObjectID}')/IndividualCustomerAddress`, {
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
    clientKind: "individual",
    buyerPartyId: created.CustomerID,
    clienteObjectId: created.ObjectID,
    wasCreated: true,
    regionCode: input.direccion.departamento,
    postalCode: input.direccion.codigoPostal,
  };
}
