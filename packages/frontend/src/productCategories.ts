/**
 * Categorias "vendibles" de electrodomesticos SOLE/Rinnai (misma lista que
 * packages/backend/src/domain/productCatalog/index.ts) - duplicada aca a
 * proposito, mismo patron que peruDepartamentos.ts/lugaresCompra.ts, para
 * no depender de una llamada de red solo para pintar el formulario.
 */
export interface ProductCategory {
  id: string;
  nombre: string;
}

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
