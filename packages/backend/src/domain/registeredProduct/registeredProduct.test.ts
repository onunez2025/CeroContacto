import type { IC4CODataClient } from "@cerocontacto/c4c-client";
import type { Address } from "@cerocontacto/shared";
import { describe, expect, it, vi } from "vitest";
import { resolveRegisteredProduct } from "./index.js";
import type { RegisteredProductInput } from "./types.js";

const direccion: Address = {
  departamento: "15",
  provincia: "128",
  distrito: "1254",
  codigoPostal: "07021",
  direccion: "AV. EL SOL",
  numero: "555",
  referencia: "Frente al parque",
};

const input: RegisteredProductInput = {
  numeroSerie: "TDM5524083854",
  productId: "10054511",
  buyerPartyId: "1038018",
  direccion,
};

function mockClient(overrides: Partial<IC4CODataClient> = {}): IC4CODataClient {
  return {
    getCollection: vi.fn().mockResolvedValue([]),
    postEntity: vi.fn(),
    patch: vi.fn(),
    ...overrides,
  };
}

describe("resolveRegisteredProduct", () => {
  it("devuelve el producto existente sin crear nada si el serial ya matchea", async () => {
    const client = mockClient({
      getCollection: vi.fn().mockResolvedValue([{ ObjectID: "OBJ1", ID: "420434", zaIDdeSerieFSM_KUT: "TDM5524083854" }]),
    });

    const result = await resolveRegisteredProduct(input, client);

    expect(result).toEqual({ installationPointId: "420434", objectId: "OBJ1", wasCreated: false });
    expect(client.postEntity).not.toHaveBeenCalled();
  });

  it("crea el producto registrado asociado al buyerPartyId cuando no hay match", async () => {
    const postEntity = vi.fn().mockResolvedValue({ ObjectID: "NEWOBJ", ID: "420999" });
    const client = mockClient({ postEntity });

    const result = await resolveRegisteredProduct(input, client);

    expect(result).toEqual({ installationPointId: "420999", objectId: "NEWOBJ", wasCreated: true });
    const [url, body] = postEntity.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toContain("RegisteredProductCollection");
    expect(body.zaIDdeSerieFSM_KUT).toBe("TDM5524083854");
    expect(body.ProductID).toBe("10054511");
    expect(body.RegisteredProductPartyInformation).toEqual([{ RoleCode: "60", PartyID: "1038018" }]);
  });

  it("omite zID_IP_LugarCompra_SDK cuando no se provee (pendiente tabla del proveedor)", async () => {
    const postEntity = vi.fn().mockResolvedValue({ ObjectID: "NEWOBJ", ID: "420999" });
    const client = mockClient({ postEntity });

    await resolveRegisteredProduct(input, client);

    const [, body] = postEntity.mock.calls[0] as [string, Record<string, unknown>];
    expect(body).not.toHaveProperty("zID_IP_LugarCompra_SDK");
  });

  it("incluye zID_IP_LugarCompra_SDK cuando se provee", async () => {
    const postEntity = vi.fn().mockResolvedValue({ ObjectID: "NEWOBJ", ID: "420999" });
    const client = mockClient({ postEntity });

    await resolveRegisteredProduct({ ...input, lugarCompraId: "000...002211" }, client);

    const [, body] = postEntity.mock.calls[0] as [string, Record<string, unknown>];
    expect(body.zID_IP_LugarCompra_SDK).toBe("000...002211");
  });
});
