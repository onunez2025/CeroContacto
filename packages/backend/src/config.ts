import { C4CODataClient } from "@cerocontacto/c4c-client";

/**
 * Construye el cliente C4C a partir de variables de entorno (local.settings.json
 * en desarrollo local; App Settings + referencias a Key Vault en Azure).
 */
export function buildC4CClientFromEnv(): C4CODataClient {
  const baseUrl = process.env.C4C_BASE_URL;
  const username = process.env.C4C_USER;
  const password = process.env.C4C_PASSWORD;

  if (!baseUrl || !username || !password) {
    throw new Error(
      "Faltan variables de entorno C4C_BASE_URL/C4C_USER/C4C_PASSWORD (local.settings.json o Key Vault en Azure)",
    );
  }

  return new C4CODataClient({ baseUrl, username, password });
}
