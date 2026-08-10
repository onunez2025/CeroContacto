import type { IC4CODataClient } from "@cerocontacto/c4c-client";
import { describe, expect, it, vi } from "vitest";
import { searchProducts } from "./index.js";

function clientReturning(items: Array<{ ProductID: string; Description: string }>): IC4CODataClient {
  return {
    getCollection: vi.fn().mockResolvedValue(items) as unknown as IC4CODataClient["getCollection"],
    postEntity: vi.fn(),
    patch: vi.fn(),
  };
}

/**
 * Cliente que responde distinto segun el campo por el que se filtra:
 * searchProducts hace DOS consultas (una por Description, otra por
 * ProductID) porque C4C rechaza combinarlas con "or".
 */
function clientPorCampo(
  porDescripcion: Array<{ ProductID: string; Description: string }>,
  porCodigo: Array<{ ProductID: string; Description: string }>,
): IC4CODataClient {
  return {
    getCollection: vi.fn(async (path: string) =>
      decodeURIComponent(path).includes(",ProductID)") ? porCodigo : porDescripcion,
    ) as unknown as IC4CODataClient["getCollection"],
    postEntity: vi.fn(),
    patch: vi.fn(),
  };
}

describe("searchProducts", () => {
  it("devuelve [] si la categoria no es una de las conocidas", async () => {
    const client = clientReturning([{ ProductID: "1", Description: "COCINA DUBAI" }]);
    const result = await searchProducts("CATEGORIA-INVENTADA", "dubai", client);
    expect(result).toEqual([]);
    expect(client.getCollection).not.toHaveBeenCalled();
  });

  it("devuelve [] si la busqueda tiene menos de 2 caracteres", async () => {
    const client = clientReturning([{ ProductID: "1", Description: "COCINA DUBAI" }]);
    const result = await searchProducts("SCP000000", "d", client);
    expect(result).toEqual([]);
    expect(client.getCollection).not.toHaveBeenCalled();
  });

  it("mapea ProductID/Description a productId/nombre y filtra por categoria + activo + nombre", async () => {
    const client = clientPorCampo(
      [
        { ProductID: "10008026", Description: "COCINA PIE GLP SOLE CLASSIC DUBAI 76CM" },
        { ProductID: "10008089", Description: "COCINA PIE GLP SOLE DUBAI 76CM" },
      ],
      [],
    );

    const result = await searchProducts("SCP000000", "dubai", client);

    expect(result).toEqual([
      { productId: "10008026", nombre: "COCINA PIE GLP SOLE CLASSIC DUBAI 76CM" },
      { productId: "10008089", nombre: "COCINA PIE GLP SOLE DUBAI 76CM" },
    ]);
    const [path] = (client.getCollection as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(path).toContain("ProductCategoryID%20eq%20'SCP000000'");
    expect(path).toContain("Status%20eq%20'2'");
    expect(path).toContain("substringof('DUBAI',Description)".replace(/[()',]/g, (c) => encodeURIComponent(c)));
  });

  it("tambien matchea por ProductID (busqueda por codigo, no solo por descripcion)", async () => {
    const client = clientPorCampo(
      [],
      [{ ProductID: "10008026", Description: "COCINA PIE GLP SOLE CLASSIC DUBAI 76CM" }],
    );

    const result = await searchProducts("SCP000000", "10008026", client);

    expect(result).toEqual([{ productId: "10008026", nombre: "COCINA PIE GLP SOLE CLASSIC DUBAI 76CM" }]);
    const paths = (client.getCollection as ReturnType<typeof vi.fn>).mock.calls.map(([p]) => decodeURIComponent(p as string));
    expect(paths.some((p) => p.includes("substringof('10008026',ProductID)"))).toBe(true);
  });

  it("nunca combina Description y ProductID con 'or' en un mismo filtro (C4C lo rechaza con 500)", async () => {
    // Regresion directa: el filtro con "or" rompio el buscador en produccion
    // el 2026-08-10 ("Operanden des logischen Operators '' sind nicht gultig").
    const client = clientPorCampo([], []);

    await searchProducts("SCP000000", "dubai", client);

    const paths = (client.getCollection as ReturnType<typeof vi.fn>).mock.calls.map(([p]) => decodeURIComponent(p as string));
    expect(paths).toHaveLength(2);
    for (const path of paths) {
      expect(path).not.toContain(" or ");
    }
    expect(paths.some((p) => p.includes("substringof('DUBAI',Description)"))).toBe(true);
    expect(paths.some((p) => p.includes("substringof('DUBAI',ProductID)"))).toBe(true);
  });

  it("deduplica por ProductID cuando un producto matchea por ambos campos", async () => {
    const repetido = { ProductID: "10008026", Description: "RAPIDUCHA SOLE PRIME 5500W" };
    const client = clientPorCampo([repetido], [repetido]);

    const result = await searchProducts("SDH000000", "prime", client);

    expect(result).toEqual([{ productId: "10008026", nombre: "RAPIDUCHA SOLE PRIME 5500W" }]);
  });
});
