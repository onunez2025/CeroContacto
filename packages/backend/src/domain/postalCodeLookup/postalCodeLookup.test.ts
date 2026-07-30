import type { IC4CODataClient } from "@cerocontacto/c4c-client";
import { describe, expect, it, vi } from "vitest";
import { hasActiveCoverage, searchPostalCodes } from "./index.js";

function clientReturning(items: Array<{ zIDDistrito: string; zPostalCodigo: string }>): IC4CODataClient {
  return {
    getCollection: vi.fn().mockResolvedValue(items) as unknown as IC4CODataClient["getCollection"],
    postEntity: vi.fn(),
    patch: vi.fn(),
  };
}

describe("searchPostalCodes", () => {
  it("devuelve [] si no hay departamento", async () => {
    const client = clientReturning([{ zIDDistrito: "SAN BORJA", zPostalCodigo: "15130" }]);
    const result = await searchPostalCodes("", "san borja", client);
    expect(result).toEqual([]);
    expect(client.getCollection).not.toHaveBeenCalled();
  });

  it("devuelve [] si la busqueda tiene menos de 2 caracteres", async () => {
    const client = clientReturning([{ zIDDistrito: "SAN BORJA", zPostalCodigo: "15130" }]);
    const result = await searchPostalCodes("15", "s", client);
    expect(result).toEqual([]);
    expect(client.getCollection).not.toHaveBeenCalled();
  });

  it("filtra por departamento + activo en el $filter de OData (sin substringof)", async () => {
    const client = clientReturning([{ zIDDistrito: "San Juan de Lurigancho", zPostalCodigo: "15453" }]);

    await searchPostalCodes("15", "lurigancho", client);

    const [path] = (client.getCollection as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(path).toContain("zRegDepart%20eq%20'15'");
    expect(path).toContain("zRegactivo%20eq%20true");
    // zIDDistrito viene en mayusculas/minusculas mixtas en C4C y `substringof`
    // es sensible a mayusculas (tolower() tampoco esta soportado por este
    // servicio) - el filtro de nombre se hace en memoria, no en el $filter.
    expect(path).not.toContain("substringof");
  });

  it("mapea zIDDistrito/zPostalCodigo a distrito/codigoPostal, filtrando por nombre sin distinguir mayusculas/minusculas", async () => {
    const client = clientReturning([
      { zIDDistrito: "San Juan de Lurigancho", zPostalCodigo: "15453" },
      { zIDDistrito: "Lurigancho, San Juan de Lurigancho", zPostalCodigo: "15457" },
      { zIDDistrito: "Miraflores", zPostalCodigo: "15074" },
    ]);

    const result = await searchPostalCodes("15", "LURIGANCHO", client);

    expect(result).toEqual([
      { distrito: "San Juan de Lurigancho", codigoPostal: "15453" },
      { distrito: "Lurigancho, San Juan de Lurigancho", codigoPostal: "15457" },
    ]);
  });
});

describe("hasActiveCoverage", () => {
  it("devuelve false si no hay departamento, sin llamar a C4C", async () => {
    const client = clientReturning([]);
    const result = await hasActiveCoverage("", client);
    expect(result).toBe(false);
    expect(client.getCollection).not.toHaveBeenCalled();
  });

  it("devuelve true si hay al menos un registro activo", async () => {
    const client = clientReturning([{ zIDDistrito: "SAN BORJA", zPostalCodigo: "15130" }]);
    const result = await hasActiveCoverage("15", client);
    expect(result).toBe(true);
    const [path] = (client.getCollection as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(path).toContain("zRegDepart%20eq%20'15'");
    expect(path).toContain("zRegactivo%20eq%20true");
  });

  it("devuelve false si no hay ningun registro activo en el departamento", async () => {
    const client = clientReturning([]);
    const result = await hasActiveCoverage("99", client);
    expect(result).toBe(false);
    const [path] = (client.getCollection as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(path).toContain("zRegDepart%20eq%20'99'");
    expect(path).toContain("zRegactivo%20eq%20true");
  });
});
