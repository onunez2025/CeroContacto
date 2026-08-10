import type { Address } from "@cerocontacto/shared";

export interface RegisteredProductInput {
  /** Mapea a zaIDdeSerieFSM_KUT (MaxLength 120). Ver riesgo de calidad de dato en index.ts. */
  numeroSerie?: string;
  /** ProductID maestro (modelo), MaxLength 60. */
  productId: string;
  /** AccountID (empresa) o CustomerID (individual) resuelto por customerResolution. */
  buyerPartyId: string;
  direccion: Address;
  /**
   * zID_IP_LugarCompra_SDK - codigo de tienda/distribuidor. Pendiente de
   * mapeo tienda->codigo por parte del proveedor (pregunta D1 del
   * cuestionario tecnico); opcional hasta entonces.
   */
  lugarCompraId?: string;
  /** WarrantyID - origen aun no definido con el negocio; opcional. */
  warrantyId?: string;
  /** Fotos del producto instalado (data URLs base64), hasta 6. Ver types.ts de shared. */
  fotos?: string[];
  /**
   * ObjectID de productos registrados ya consumidos por otro item de ESTE
   * mismo envio. Dos filas del mismo modelo en un combo son dos unidades
   * fisicas distintas (el cliente las agrego por separado), aunque la
   * consulta por dueño+modelo+direccion las encuentre como candidatas: sin
   * esta exclusion, el segundo item reutilizaria el producto que el primero
   * acaba de crear.
   */
  excluirObjectIds?: string[];
}

export interface RegisteredProductResult {
  /** RegisteredProduct.ID - usado como InstallationPointID al crear el ticket. */
  installationPointId: string;
  objectId: string;
  wasCreated: boolean;
}

export interface RegisteredProductRecord {
  ObjectID: string;
  ID: string;
  SerialID?: string;
  ProductID?: string;
  zaIDdeSerieFSM_KUT?: string;
}

/**
 * Fila de RegisteredProductPartyInformationCollection. Se consulta para
 * confirmar que un producto candidato pertenece de verdad al cliente actual
 * antes de reutilizarlo.
 */
export interface RegisteredProductPartyRecord {
  ParentObjectID: string;
}
