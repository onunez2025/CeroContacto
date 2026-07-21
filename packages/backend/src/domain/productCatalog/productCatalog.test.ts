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
    const client = clientReturning([
      { ProductID: "10008026", Description: "COCINA PIE GLP SOLE CLASSIC DUBAI 76CM" },
      { ProductID: "10008089", Description: "COCINA PIE GLP SOLE DUBAI 76CM" },
    ]);

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
});
