export interface TicketCreationInput {
  /** AccountID (empresa) o CustomerID (individual). */
  buyerPartyId: string;
  productId: string;
  /** RegisteredProduct.ID resuelto por registeredProduct. */
  installationPointId: string;
  /** Z_CabRegion_KUT - zRegRegin resuelto por cuposEngine. */
  cabRegion: string;
  /** zIDEmpresa_SDK - contratista asignado por cuposEngine. */
  companyId: string;
  /** RequestInitialReceiptdatetimecontent - fecha de visita solicitada. */
  fechaVisita: string;
  /** zaRegionFSM_ID_KUT. */
  regionFsmId: string;
  /** zaRegionFSM_KUT. */
  regionFsm: string;
  /** zIDRegistroCupoArea_SDK - reserva de cupo confirmada por cuposEngine. */
  reservationId: string;
  /** zTicketIDProvinciacontent_SDK. */
  provincia: string;
  /** zTicketIDDistritocontent_SDK. */
  distrito: string;
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
