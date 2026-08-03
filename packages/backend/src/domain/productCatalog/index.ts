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

/**
 * Busca productos activos de una categoria por coincidencia parcial de
 * nombre (autocompletado). Contra el cliente de catalogo (produccion,
 * solo lectura) - nunca se usa para crear nada.
 */
export async function searchProducts(
  categoriaId: string,
  query: string,
  client: IC4CODataClient,
): Promise<ProductCatalogItem[]> {
  const trimmed = query.trim();
  if (!CATEGORY_IDS.has(categoriaId) || trimmed.length < 2) return [];

  const texto = escapeODataString(trimmed.toUpperCase());
  const filter = [
    `ProductCategoryID eq '${escapeODataString(categoriaId)}'`,
    `Status eq '2'`,
    `(substringof('${texto}',Description) or substringof('${texto}',ProductID))`,
  ].join(" and ");

  const results = await client.getCollection<{ ProductID: string; Description: string }>(
    `${NS}/ProductCollection?$filter=${encodeURIComponent(filter)}&$top=20&$select=ProductID,Description`,
  );

  return results.map((r) => ({ productId: r.ProductID, nombre: r.Description }));
}
