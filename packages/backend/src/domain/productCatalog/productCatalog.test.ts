import type { IC4CODataClient } from "@cerocontacto/c4c-client";
import { describe, expect, it, vi } from "vitest";
import { searchProducts } from "./index.js";

interface Row {
  ProductID: string;
  ExternalID?: string;
  Description: string;
}

function clientReturning(items: Row[]): IC4CODataClient {
  return {
    getCollection: vi.fn().mockResolvedValue(items) as unknown as IC4CODataClient["getCollection"],
    postEntity: vi.fn(),
    patch: vi.fn(),
  };
}

/**
 * Cliente que responde distinto segun el campo por el que se filtra:
 * searchProducts hace DOS consultas (una por Description, otra por
 * ExternalID) porque C4C rechaza combinarlas con "or".
 */
function clientPorCampo(porDescripcion: Row[], porCodigo: Row[]): IC4CODataClient {
  return {
    getCollection: vi.fn(async (path: string) =>
      decodeURIComponent(path).includes(",ExternalID)") ? porCodigo : porDescripcion,
    ) as unknown as IC4CODataClient["getCollection"],
    postEntity: vi.fn(),
    patch: vi.fn(),
  };
}

describe("searchProducts", () => {
  /**
   * El cliente ya no elige categoria (observacion 2, 2026-08-18). El acotado
   * a las 9 categorias instalables pasa a ser interno: sin el, la misma
   * busqueda devolveria despiece y repuestos ("DESPIECE RAP. PRIME").
   */
  it("acota siempre a las 9 categorias instalables aunque el cliente no elija ninguna", async () => {
    const client = clientPorCampo([], []);

    await searchProducts("dubai", client);

    const paths = (client.getCollection as ReturnType<typeof vi.fn>).mock.calls.map(([p]) => decodeURIComponent(p as string));
    expect(paths).toHaveLength(2);
    for (const path of paths) {
      expect(path).toContain("ProductCategoryID eq 'SCE000000'");
      expect(path).toContain("ProductCategoryID eq 'SNT000000'");
    }
  });

  it("devuelve [] si la busqueda tiene menos de 2 caracteres", async () => {
    const client = clientReturning([{ ProductID: "1", Description: "COCINA DUBAI" }]);
    const result = await searchProducts("d", client);
    expect(result).toEqual([]);
    expect(client.getCollection).not.toHaveBeenCalled();
  });

  it("mapea ProductID/ExternalID/Description y filtra por activo + nombre", async () => {
    const client = clientPorCampo(
      [
        {
          ProductID: "10008026",
          ExternalID: "3120COSOL026V2",
          Description: "COCINA PIE GLP SOLE CLASSIC DUBAI 76CM",
        },
        { ProductID: "10008089", ExternalID: "3120COSOL089V2", Description: "COCINA PIE GLP SOLE DUBAI 76CM" },
      ],
      [],
    );

    const result = await searchProducts("dubai", client);

    expect(result).toEqual([
      { productId: "10008026", codigo: "3120COSOL026V2", nombre: "COCINA PIE GLP SOLE CLASSIC DUBAI 76CM" },
      { productId: "10008089", codigo: "3120COSOL089V2", nombre: "COCINA PIE GLP SOLE DUBAI 76CM" },
    ]);
    const [path] = (client.getCollection as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(path).toContain("Status%20eq%20'2'");
    expect(path).toContain("substringof('DUBAI',Description)".replace(/[()',]/g, (c) => encodeURIComponent(c)));
  });

  /**
   * El codigo que el cliente tiene en la boleta es el ExternalID
   * ("3120COSOL026V2"), no el ProductID ("10008026", un correlativo interno
   * que no aparece en ningun lado de cara al cliente). Buscar por ProductID,
   * como se hacia antes, no daba ninguna coincidencia con lo que el cliente
   * escribe (confirmado con el usuario contra Administracion de producto de
   * C4C, 2026-08-17).
   */
  it("matchea por ExternalID, que es el codigo que el cliente ve", async () => {
    const client = clientPorCampo(
      [],
      [{ ProductID: "10008026", ExternalID: "3120COSOL026V2", Description: "COCINA PIE GLP SOLE CLASSIC DUBAI 76CM" }],
    );

    const result = await searchProducts("3120COSOL026V2", client);

    expect(result).toEqual([
      { productId: "10008026", codigo: "3120COSOL026V2", nombre: "COCINA PIE GLP SOLE CLASSIC DUBAI 76CM" },
    ]);
    const paths = (client.getCollection as ReturnType<typeof vi.fn>).mock.calls.map(([p]) => decodeURIComponent(p as string));
    expect(paths.some((p) => p.includes("substringof('3120COSOL026V2',ExternalID)"))).toBe(true);
  });

  it("busca en mayusculas: ExternalID distingue mayus/minus en C4C", async () => {
    const client = clientPorCampo([], []);

    await searchProducts("3120cosol026v2", client);

    const paths = (client.getCollection as ReturnType<typeof vi.fn>).mock.calls.map(([p]) => decodeURIComponent(p as string));
    expect(paths.some((p) => p.includes("substringof('3120COSOL026V2',ExternalID)"))).toBe(true);
  });

  it("nunca combina Description y ExternalID con 'or' en un mismo filtro (C4C lo rechaza con 500)", async () => {
    // Regresion directa: el filtro con "or" rompio el buscador en produccion
    // el 2026-08-10 ("Operanden des logischen Operators '' sind nicht gultig").
    const client = clientPorCampo([], []);

    await searchProducts("dubai", client);

    const paths = (client.getCollection as ReturnType<typeof vi.fn>).mock.calls.map(([p]) => decodeURIComponent(p as string));
    expect(paths).toHaveLength(2);
    // Lo prohibido es combinar los dos CAMPOS de texto en un mismo filtro. El
    // "or" entre valores de ProductCategoryID si lo acepta C4C y es el que
    // acota a las categorias instalables.
    for (const path of paths) {
      expect(path).not.toContain("Description) or ");
      expect(path).not.toContain("ExternalID) or ");
    }
    expect(paths.some((p) => p.includes("substringof('DUBAI',Description)"))).toBe(true);
    expect(paths.some((p) => p.includes("substringof('DUBAI',ExternalID)"))).toBe(true);
  });

  it("deduplica por ProductID cuando un producto matchea por ambos campos", async () => {
    const repetido = { ProductID: "10008026", ExternalID: "3121SOLRD5500V3C", Description: "RAPIDUCHA SOLE PRIME 5500W" };
    const client = clientPorCampo([repetido], [repetido]);

    const result = await searchProducts("prime", client);

    expect(result).toEqual([
      { productId: "10008026", codigo: "3121SOLRD5500V3C", nombre: "RAPIDUCHA SOLE PRIME 5500W" },
    ]);
  });

  it("un producto sin ExternalID cargado se muestra con el ProductID en vez de sin codigo", async () => {
    const client = clientPorCampo([{ ProductID: "10008026", Description: "COCINA SIN CODIGO EXTERNO" }], []);

    const result = await searchProducts("cocina", client);

    expect(result).toEqual([{ productId: "10008026", codigo: "10008026", nombre: "COCINA SIN CODIGO EXTERNO" }]);
  });
});
