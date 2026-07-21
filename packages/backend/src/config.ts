import { C4CODataClient } from "@cerocontacto/c4c-client";

/**
 * Construye el cliente C4C a partir de variables de entorno (.env.*.local en
 * desarrollo local; variables de entorno inyectadas por Dokploy en produccion).
 */
export function buildC4CClientFromEnv(): C4CODataClient {
  const baseUrl = process.env.C4C_BASE_URL;
  const username = process.env.C4C_USER;
  const password = process.env.C4C_PASSWORD;

  if (!baseUrl || !username || !password) {
    throw new Error("Faltan variables de entorno C4C_BASE_URL/C4C_USER/C4C_PASSWORD");
  }

  return new C4CODataClient({ baseUrl, username, password });
}

/**
 * Cliente C4C separado, de solo lectura, apuntando siempre al tenant de
 * produccion (unica fuente con el catalogo real de productos SOLE/Rinnai -
 * QA tiene datos de otra linea de negocio). Independiente de a donde vayan
 * los tickets (buildC4CClientFromEnv, que si sigue QA en desarrollo).
 */
export function buildProductCatalogClientFromEnv(): C4CODataClient {
  const baseUrl = process.env.C4C_CATALOG_BASE_URL;
  const username = process.env.C4C_CATALOG_USER;
  const password = process.env.C4C_CATALOG_PASSWORD;

  if (!baseUrl || !username || !password) {
    throw new Error("Faltan variables de entorno C4C_CATALOG_BASE_URL/C4C_CATALOG_USER/C4C_CATALOG_PASSWORD");
  }

  return new C4CODataClient({ baseUrl, username, password });
}
