import type { IC4CODataClient } from "@cerocontacto/c4c-client";
import { lookupEmpresa } from "./empresa.js";
import { lookupIndividual } from "./individual.js";
import type { CustomerLookupResult } from "./types.js";

export * from "./types.js";

export async function lookupCustomer(
  tipoDocumento: "DNI" | "CE" | "RUC",
  numeroDocumento: string,
  client: IC4CODataClient,
): Promise<CustomerLookupResult> {
  return tipoDocumento === "RUC" ? lookupEmpresa(numeroDocumento, client) : lookupIndividual(tipoDocumento, numeroDocumento, client);
}
