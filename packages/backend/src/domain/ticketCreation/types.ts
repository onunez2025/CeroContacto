export interface TicketCreationInput {
  /** AccountID (empresa) o CustomerID (individual). */
  buyerPartyId: string;
  productId: string;
  /** RegisteredProduct.ID resuelto por registeredProduct. */
  installationPointId: string;
  /**
   * Z_CabRegion_KUT - zRegRegin resuelto por cuposEngine. Opcional: el
   * motor de cupos esta deshabilitado en produccion hasta que C4C
   * despliegue ahi los servicios custom "cupoporarea" y "cust_producto"
   * (no implementados en produccion, confirmado en vivo el 2026-07-24 -
   * "No implementation for service 'CUPOPORAREA'"/"'CUST_PRODUCTO'"). Sin
   * cuposEngine, el ticket se crea sin contratista/region asignados
   * automaticamente; el asesor los asigna manualmente en C4C despues,
   * igual que hace hoy sin este formulario.
   */
  cabRegion?: string;
  /** zIDEmpresa_SDK - contratista asignado por cuposEngine. Ver nota de cabRegion. */
  companyId?: string;
  /** RequestInitialReceiptdatetimecontent - fecha de visita solicitada. */
  fechaVisita: string;
  /** zaRegionFSM_ID_KUT. Ver nota de cabRegion (este campo ademas no existe todavia en el customizing de produccion). */
  regionFsmId?: string;
  /** zaRegionFSM_KUT. Ver nota de cabRegion. */
  regionFsm?: string;
  /** zIDRegistroCupoArea_SDK - reserva de cupo confirmada por cuposEngine. Ver nota de cabRegion. */
  reservationId?: string;
  /** zTicketIDProvinciacontent_SDK. */
  provincia: string;
  /** zTicketIDDistritocontent_SDK. */
  distrito: string;
  /** zLatitud_SDK - punto que el cliente marco en el mapa. */
  latitud: number;
  /** zLongitud_SDK. */
  longitud: number;
  /** ServiceIssueCategoryID - por defecto SERVICE_TYPE_ID (instalacion). */
  serviceIssueCategoryId?: string;
  /**
   * Comentario del cliente sobre el estado del producto/servicio requerido.
   * Se guarda como ServiceRequestTextCollection con TypeCode "10004"
   * ("Case Description", confirmado en vivo contra QA - ticket 138374).
   */
  comentario?: string;
}

export interface TicketCreationResult {
  ticketObjectId: string;
  ticketId: string;
}

export interface ServiceRequestRecord {
  ObjectID: string;
  ID: string;
}
