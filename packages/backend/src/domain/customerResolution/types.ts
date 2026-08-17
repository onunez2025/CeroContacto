import type { Address } from "@cerocontacto/shared";

/**
 * Resultado unificado de los casos del documento tecnico (Empresa/
 * Individual x nuevo/existente, mas CE como variante de Individual).
 * `regionCode`/`postalCode` provienen del formulario cuando el cliente se
 * acaba de crear (son los mismos valores que se enviaron a C4C), o de una
 * consulta a C4C cuando el cliente ya existia (su direccion registrada
 * puede diferir de la ingresada ahora).
 */
export interface CustomerResolutionResult {
  clientKind: "empresa" | "individual";
  /** AccountID (empresa) o CustomerID (individual) - usado como BuyerPartyID del ticket. */
  buyerPartyId: string;
  /** ObjectID raiz del cliente (Root node), usado para asociar el producto registrado. */
  clienteObjectId: string;
  wasCreated: boolean;
  regionCode: string;
  postalCode: string;
}

export interface EmpresaInput {
  tipoDocumento: "RUC";
  numeroDocumento: string;
  razonSocial: string;
  telefono: string;
  telefono2?: string;
  email: string;
  direccion: Address;
}

/**
 * TaxTypeCode confirmado en vivo contra C4C QA (my360657):
 * CorporateAccountTaxNumberTaxTypeCodeCollection / IndividualCustomer...
 * ?$filter=Context eq 'PE' -> "1"=RUC, "2"=DNI, "3"=Pasaporte, "5"=ID extranjero.
 */
export const INDIVIDUAL_TAX_TYPE_CODE = {
  DNI: "2",
  CE: "5",
} as const;

export interface IndividualInput {
  tipoDocumento: "DNI" | "CE";
  numeroDocumento: string;
  nombres: string;
  apellidos: string;
  telefono: string;
  telefono2?: string;
  email: string;
  direccion: Address;
}

export type CustomerResolutionInput = EmpresaInput | IndividualInput;

/** Nota: `departamento` debe llegar ya como el StateCode tecnico de C4C
 * (ej. "15" para Lima), resuelto por el endpoint de lookups de ubigeo del
 * formulario - no como texto libre. */
export interface CorporateAccountTaxNumber {
  ParentObjectID: string;
  AccountID: string;
}

export interface CorporateAccount {
  ObjectID: string;
  AccountID: string;
  StateCode?: string;
  StreetPostalCode?: string;
  /** Datos de contacto actuales, para detectar que cambio el cliente (ver contactSync). */
  Name?: string;
  Phone?: string;
  Mobile?: string;
  Email?: string;
}

export interface IndividualCustomerTaxNumber {
  ParentObjectID: string;
  CustomerID: string;
}

export interface IndividualCustomer {
  ObjectID: string;
  CustomerID: string;
  StateCode?: string;
  StreetPostalCode?: string;
  /** Datos de contacto actuales, para detectar que cambio el cliente (ver contactSync). */
  FirstName?: string;
  LastName?: string;
  Phone?: string;
  Mobile?: string;
  Email?: string;
}
