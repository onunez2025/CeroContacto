import type { IC4CODataClient } from "@cerocontacto/c4c-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearActiveRecordsCacheForTests,
  hasActiveCoverage,
  isValidPostalCode,
  searchPostalCodes,
} from "./index.js";

function clientReturning(items: Array<{ zIDDistrito: string; zPostalCodigo: string }>): IC4CODataClient {
  return {
    getCollection: vi.fn().mockResolvedValue(items) as unknown as IC4CODataClient["getCollection"],
    postEntity: vi.fn(),
    patch: vi.fn(),
  };
}

beforeEach(() => {
  // El cache de zonas activas es un Map a nivel de modulo, compartido entre
  // searchPostalCodes/hasActiveCoverage/isValidPostalCode. Sin limpiarlo entre
  // tests, dos tests que usan el mismo departamento (p.ej. "15") con clientes
  // mock distintos se contaminarian entre si.
  clearActiveRecordsCacheForTests();
});

describe("searchPostalCodes", () => {
  it("devuelve resultados vacios si no hay departamento", async () => {
    const client = clientReturning([{ zIDDistrito: "SAN BORJA", zPostalCodigo: "15130" }]);
    const result = await searchPostalCodes("", "san borja", client);
    expect(result).toEqual({ resultados: [], hayMasResultados: false });
    expect(client.getCollection).not.toHaveBeenCalled();
  });

  it("devuelve resultados vacios si la busqueda tiene menos de 2 caracteres", async () => {
    const client = clientReturning([{ zIDDistrito: "SAN BORJA", zPostalCodigo: "15130" }]);
    const result = await searchPostalCodes("15", "s", client);
    expect(result).toEqual({ resultados: [], hayMasResultados: false });
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

    expect(result).toEqual({
      resultados: [
        { distrito: "San Juan de Lurigancho", codigoPostal: "15453" },
        { distrito: "Lurigancho, San Juan de Lurigancho", codigoPostal: "15457" },
      ],
      hayMasResultados: false,
    });
  });

  it("marca hayMasResultados=true cuando hay mas de 20 coincidencias, recortando a 20", async () => {
    const items = Array.from({ length: 25 }, (_, i) => ({
      zIDDistrito: `Lurigancho Zona ${i}`,
      zPostalCodigo: `1500${i}`,
    }));
    const client = clientReturning(items);

    const result = await searchPostalCodes("15", "lurigancho", client);

    expect(result.resultados).toHaveLength(20);
    expect(result.hayMasResultados).toBe(true);
  });

  it("marca hayMasResultados=false cuando hay exactamente 20 coincidencias", async () => {
    const items = Array.from({ length: 20 }, (_, i) => ({
      zIDDistrito: `Lurigancho Zona ${i}`,
      zPostalCodigo: `1500${i}`,
    }));
    const client = clientReturning(items);

    const result = await searchPostalCodes("15", "lurigancho", client);

    expect(result.resultados).toHaveLength(20);
    expect(result.hayMasResultados).toBe(false);
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

describe("isValidPostalCode", () => {
  it("devuelve false si falta departamento o codigoPostal, sin llamar a C4C", async () => {
    const client = clientReturning([{ zIDDistrito: "SAN BORJA", zPostalCodigo: "15130" }]);
    expect(await isValidPostalCode("", "15130", client)).toBe(false);
    expect(await isValidPostalCode("15", "", client)).toBe(false);
    expect(client.getCollection).not.toHaveBeenCalled();
  });

  it("devuelve true si el codigo postal existe entre los registros activos del departamento", async () => {
    const client = clientReturning([
      { zIDDistrito: "SAN BORJA", zPostalCodigo: "15130" },
      { zIDDistrito: "MIRAFLORES", zPostalCodigo: "15074" },
    ]);
    expect(await isValidPostalCode("15", "15074", client)).toBe(true);
  });

  it("devuelve false si el codigo postal no esta entre los registros activos del departamento", async () => {
    const client = clientReturning([{ zIDDistrito: "SAN BORJA", zPostalCodigo: "15130" }]);
    expect(await isValidPostalCode("15", "99999", client)).toBe(false);
  });
});

describe("cache de zonas activas compartido entre searchPostalCodes/hasActiveCoverage/isValidPostalCode", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("no vuelve a llamar a C4C para el mismo departamento dentro de la ventana de 10 minutos", async () => {
    const client = clientReturning([{ zIDDistrito: "SAN BORJA", zPostalCodigo: "15130" }]);

    await hasActiveCoverage("15", client);
    await searchPostalCodes("15", "san borja", client);
    await isValidPostalCode("15", "15130", client);

    expect(client.getCollection).toHaveBeenCalledTimes(1);
  });

  it("vuelve a consultar C4C para el mismo departamento despues de que expira el TTL de 10 minutos", async () => {
    const client = clientReturning([{ zIDDistrito: "SAN BORJA", zPostalCodigo: "15130" }]);

    await hasActiveCoverage("15", client);
    vi.advanceTimersByTime(10 * 60_000 + 1);
    await hasActiveCoverage("15", client);

    expect(client.getCollection).toHaveBeenCalledTimes(2);
  });

  it("mantiene caches independientes por departamento", async () => {
    const client = clientReturning([{ zIDDistrito: "SAN BORJA", zPostalCodigo: "15130" }]);

    await hasActiveCoverage("15", client);
    await hasActiveCoverage("99", client);

    expect(client.getCollection).toHaveBeenCalledTimes(2);
  });

  it("registra una advertencia si la cantidad de registros activos alcanza el tope de $top=2000 (posible truncamiento)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const items = Array.from({ length: 2000 }, (_, i) => ({
      zIDDistrito: `Distrito ${i}`,
      zPostalCodigo: `${10000 + i}`,
    }));
    const client = clientReturning(items);

    await hasActiveCoverage("15", client);

    expect(warnSpy).toHaveBeenCalledWith("postal_codes_possible_truncation", { departamento: "15", count: 2000 });
    warnSpy.mockRestore();
  });

  it("no registra advertencia cuando la cantidad de registros esta por debajo del tope", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const client = clientReturning([{ zIDDistrito: "SAN BORJA", zPostalCodigo: "15130" }]);

    await hasActiveCoverage("15", client);

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
