import type { IC4CODataClient } from "@cerocontacto/c4c-client";
import type { ProductCatalogItem, ProductCategory } from "./types.js";

export * from "./types.js";

const NS = "v1/c4codataapi";

/**
 * Categorias "vendibles" de electrodomesticos SOLE/Rinnai bajo la raiz
 * SOLE del ProductCategoryHierarchy de C4C (produccion) - confirmadas
 * manualmente via OData, excluyendo repuestos/despiece/descontinuados/
 * sin habilitar/servicios. Los productos Rinnai comparten estas mismas
 * categorias (no hay una jerarquia separada por marca); se distinguen
 * por el nombre del producto. Los codigos no cambian con frecuencia,
 * por eso van fijos aca en vez de una llamada en vivo a C4C.
 */
export const PRODUCT_CATEGORIES: ProductCategory[] = [
  { id: "SCE000000", nombre: "Cocinas empotrables" },
  { id: "SCP000000", nombre: "Cocinas de pie" },
  { id: "SCV000000", nombre: "Cocinas vitroceramicas" },
  { id: "SDH000000", nombre: "Duchas instantaneas (rapiduchas)" },
  { id: "STA000000", nombre: "Termas a gas de acumulacion" },
  { id: "STP000000", nombre: "Termas a gas de paso continuo" },
  { id: "STE000000", nombre: "Termas electricas" },
  { id: "SNC000000", nombre: "Campanas convencionales" },
  { id: "SNT000000", nombre: "Campanas decorativas" },
];

const CATEGORY_IDS = new Set(PRODUCT_CATEGORIES.map((c) => c.id));

function escapeODataString(value: string): string {
  return value.replace(/'/g, "''");
}

/** Maximo de sugerencias que devuelve el autocompletado. */
const MAX_RESULTS = 20;

interface ProductRow {
  ProductID: string;
  ExternalID?: string;
  Description: string;
}

/**
 * Una sola consulta acotada a categoria + activo + coincidencia parcial
 * sobre UN campo. No se combinan dos campos con "or" en el mismo $filter:
 * C4C lo rechaza con un 500 real ("Operanden des logischen Operators ''
 * sind nicht gultig"), confirmado en vivo contra produccion el 2026-08-10
 * - fue la causa de que el buscador de productos dejara de responder.
 * Cada campo por separado si funciona, por eso searchProducts hace dos
 * consultas y las fusiona.
 *
 * `ExternalID` acepta substringof igual que `Description` (probado en vivo
 * contra produccion el 2026-08-17, exacto y parcial). Es sensible a
 * mayusculas - buscar 'solrd5500' devuelve 0 - pero searchProducts ya
 * normaliza el texto a mayusculas antes de llegar aca.
 */
async function searchByField(
  categoriaId: string,
  texto: string,
  campo: "Description" | "ExternalID",
  client: IC4CODataClient,
): Promise<ProductRow[]> {
  const filter = [
    `ProductCategoryID eq '${escapeODataString(categoriaId)}'`,
    `Status eq '2'`,
    `substringof('${texto}',${campo})`,
  ].join(" and ");

  return client.getCollection<ProductRow>(
    `${NS}/ProductCollection?$filter=${encodeURIComponent(filter)}&$top=${MAX_RESULTS}&$select=ProductID,ExternalID,Description`,
  );
}

/**
 * Busca productos activos de una categoria por coincidencia parcial de
 * descripcion O de codigo (autocompletado). Contra el cliente de catalogo
 * (produccion, solo lectura) - nunca se usa para crear nada.
 *
 * El "codigo" es `ExternalID` ("3121SOLRD5500V3C"), no `ProductID`: este
 * ultimo es un correlativo interno ("10018698") que el cliente nunca ve.
 * Buscar por ProductID, como se hacia antes, no servia de nada - el codigo
 * que el cliente tiene en la boleta o en la etiqueta del producto es el
 * ExternalID, y contra ProductID no daba ninguna coincidencia (confirmado
 * con el usuario, 2026-08-17, comparando contra Administracion de producto
 * en C4C).
 *
 * Las dos consultas van en paralelo y se fusionan aca, deduplicando por
 * ProductID (un producto puede matchear por ambos campos). Ver la nota de
 * searchByField sobre por que no se resuelve con un solo $filter.
 */
export async function searchProducts(
  categoriaId: string,
  query: string,
  client: IC4CODataClient,
): Promise<ProductCatalogItem[]> {
  const trimmed = query.trim();
  if (!CATEGORY_IDS.has(categoriaId) || trimmed.length < 2) return [];

  const texto = escapeODataString(trimmed.toUpperCase());
  const [porDescripcion, porCodigo] = await Promise.all([
    searchByField(categoriaId, texto, "Description", client),
    searchByField(categoriaId, texto, "ExternalID", client),
  ]);

  const vistos = new Set<string>();
  const fusionados: ProductCatalogItem[] = [];
  for (const row of [...porDescripcion, ...porCodigo]) {
    if (vistos.has(row.ProductID)) continue;
    vistos.add(row.ProductID);
    fusionados.push({
      productId: row.ProductID,
      // Un producto sin ExternalID cargado igual se puede elegir; se muestra
      // con el ProductID en vez de dejar el codigo en blanco.
      codigo: row.ExternalID?.trim() || row.ProductID,
      nombre: row.Description,
    });
    if (fusionados.length === MAX_RESULTS) break;
  }
  return fusionados;
}
