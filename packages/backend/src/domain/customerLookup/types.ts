import { z } from "zod";
import type { Address } from "@cerocontacto/shared";

export interface CustomerLookupData {
  nombres?: string;
  apellidos?: string;
  razonSocial?: string;
  telefono: string;
  email: string;
  direccion: Partial<Address>;
}

export interface CustomerLookupResult {
  found: boolean;
  datos?: CustomerLookupData;
}

/** Fila de IndividualCustomerTaxNumberCollection / CorporateAccountTaxNumberCollection. */
export interface TaxNumberLookupRecord {
  ParentObjectID: string;
  CustomerID?: string;
  AccountID?: string;
}

/** Campos leidos de IndividualCustomerCollection para autocompletar. */
export interface IndividualCustomerLookupRecord {
  ObjectID: string;
  CustomerID: string;
  FirstName?: string;
  LastName?: string;
  Phone?: string;
  /**
   * Segunda linea telefonica. Se lee ademas de Phone porque en datos reales
   * de produccion hay clientes con Phone vacio y el numero cargado solo aca
   * (confirmado el 2026-08-11 en el cliente 1125569: Phone="" y
   * Mobile="+51 960 560 064"), lo que dejaba el campo Telefono en blanco al
   * autocompletar aunque C4C si tuviera el dato.
   */
  Mobile?: string;
  Email?: string;
}

/** Campos leidos de CorporateAccountCollection para autocompletar. */
export interface CorporateAccountLookupRecord {
  ObjectID: string;
  AccountID: string;
  Name?: string;
  Phone?: string;
  /** Ver la nota de Mobile en IndividualCustomerLookupRecord. */
  Mobile?: string;
  Email?: string;
}

/** Fila de IndividualCustomerAddress / CorporateAccountAddress (misma forma en ambas). */
export interface AddressSubRecord {
  StateCode?: string;
  zIDProvinciacontent_SDK?: string;
  zIDDistritocontent_SDK?: string;
  Street?: string;
  HouseNumber?: string;
  Floor?: string;
  AddressLine5?: string;
  StreetPostalCode?: string;
}

export const CustomerLookupQuerySchema = z.object({
  tipoDocumento: z.enum(["DNI", "CE", "RUC"]),
  numeroDocumento: z.string().min(1),
});
