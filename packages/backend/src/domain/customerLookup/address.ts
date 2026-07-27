import type { Address } from "@cerocontacto/shared";
import type { AddressSubRecord } from "./types.js";

/**
 * Convierte la fila cruda de IndividualCustomerAddress/CorporateAccountAddress
 * a un `Partial<Address>` - solo incluye los campos que C4C tenga registrados,
 * para que el frontend deje vacio lo que falte en vez de pisarlo con "".
 */
export function buildDireccion(address: AddressSubRecord | undefined): Partial<Address> {
  if (!address) return {};
  const direccion: Partial<Address> = {};
  if (address.StateCode) direccion.departamento = address.StateCode;
  if (address.zIDProvinciacontent_SDK) direccion.provincia = address.zIDProvinciacontent_SDK;
  if (address.zIDDistritocontent_SDK) direccion.distrito = address.zIDDistritocontent_SDK;
  if (address.Street) direccion.direccion = address.Street;
  if (address.HouseNumber) direccion.numero = address.HouseNumber;
  if (address.Floor) direccion.piso = address.Floor;
  if (address.AddressLine5) direccion.referencia = address.AddressLine5;
  if (address.StreetPostalCode) direccion.codigoPostal = address.StreetPostalCode;
  return direccion;
}
