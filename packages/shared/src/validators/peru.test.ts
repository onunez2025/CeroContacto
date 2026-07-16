import { describe, expect, it } from "vitest";
import { isValidCe, isValidDni, isValidRuc } from "./peru.js";

describe("isValidRuc", () => {
  it("acepta un RUC valido con digito verificador correcto", () => {
    // 20525512348 aparece como ejemplo de RUC en la coleccion Postman del proveedor
    expect(isValidRuc("20525512348")).toBe(true);
  });

  it("rechaza un RUC con digito verificador incorrecto", () => {
    expect(isValidRuc("20525512340")).toBe(false);
  });

  it("rechaza formatos invalidos", () => {
    expect(isValidRuc("123")).toBe(false);
    expect(isValidRuc("2052551234a")).toBe(false);
  });
});

describe("isValidDni", () => {
  it("acepta 8 digitos", () => {
    expect(isValidDni("15619884")).toBe(true);
  });

  it("rechaza longitudes distintas de 8", () => {
    expect(isValidDni("1234567")).toBe(false);
    expect(isValidDni("123456789")).toBe(false);
  });
});

describe("isValidCe", () => {
  it("acepta formatos alfanumericos de 6 a 12 caracteres", () => {
    expect(isValidCe("AB123456")).toBe(true);
    expect(isValidCe("000123456")).toBe(true);
  });

  it("rechaza formatos demasiado cortos o con caracteres invalidos", () => {
    expect(isValidCe("AB12")).toBe(false);
    expect(isValidCe("AB-123456")).toBe(false);
  });
});
