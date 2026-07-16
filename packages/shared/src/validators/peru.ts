/**
 * Validacion de documentos de identidad peruanos usados por C4C
 * (CorporateAccountTaxNumber / IndividualCustomerTaxNumber).
 */

const RUC_FACTORS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2] as const;

/** RUC: 11 digitos + digito verificador modulo 11 (algoritmo SUNAT). */
export function isValidRuc(ruc: string): boolean {
  if (!/^\d{11}$/.test(ruc)) return false;
  const digits = ruc.split("").map(Number);
  const sum = RUC_FACTORS.reduce((acc, factor, i) => acc + factor * (digits[i] ?? 0), 0);
  const remainder = sum % 11;
  let checkDigit = 11 - remainder;
  if (checkDigit === 10) checkDigit = 0;
  else if (checkDigit === 11) checkDigit = 1;
  return checkDigit === digits[10];
}

/** DNI: 8 digitos. RENIEC no publica un digito verificador de uso general. */
export function isValidDni(dni: string): boolean {
  return /^\d{8}$/.test(dni);
}

/**
 * CE (Carné de Extranjería): sin digito verificador publico ni longitud
 * fija oficial (formatos antiguos de 9 digitos, mas recientes alfanumericos).
 * Validacion laxa: 6-12 caracteres alfanumericos. Confirmado en C4C real
 * (my360657, QA) como TaxTypeCode "5" = "ID extranjero".
 */
export function isValidCe(ce: string): boolean {
  return /^[A-Za-z0-9]{6,12}$/.test(ce);
}
