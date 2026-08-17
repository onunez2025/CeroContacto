export interface ProductCategory {
  id: string;
  nombre: string;
}

export interface ProductCatalogItem {
  /**
   * ProductID de C4C - un numero interno ("10018698"). Es el valor que
   * aceptan ServiceRequest.ProductID y RegisteredProduct, asi que es el que
   * se envia al crear el ticket, pero NO se le muestra al cliente: no
   * significa nada para el ni aparece en su boleta.
   */
  productId: string;
  /**
   * ExternalID de C4C ("3121SOLRD5500V3C") - el codigo que el negocio ve en
   * Administracion de producto (columnas "ID"/"ID externo") y el que el
   * cliente tiene a mano. Es el que se muestra y por el que se busca.
   * Cae de vuelta a productId si un producto no lo tuviera cargado.
   */
  codigo: string;
  nombre: string;
}
