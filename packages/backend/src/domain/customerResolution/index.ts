import type { IC4CODataClient } from "@cerocontacto/c4c-client";
import { resolveEmpresa } from "./empresa.js";
import { resolveIndividual } from "./individual.js";
import type { CustomerResolutionInput, CustomerResolutionResult } from "./types.js";

export * from "./types.js";
export * from "./contactSync.js";

export async function resolveCustomer(
  input: CustomerResolutionInput,
  client: IC4CODataClient,
): Promise<CustomerResolutionResult> {
  return input.tipoDocumento === "RUC" ? resolveEmpresa(input, client) : resolveIndividual(input, client);
}
