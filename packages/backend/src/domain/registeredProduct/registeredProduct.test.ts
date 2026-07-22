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
    expect(body.District).toBe("BARRANCO");
    expect(body.zIPointIDProvinciacontent_SDK).toBe("128");
    expect(body.zIPointIDDistritocontent_SDK).toBe("1254");
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

  const fakeFoto1 = "data:image/jpeg;base64,AAAA";
  const fakeFoto2 = "data:image/png;base64,BBBB";

  it("sube cada foto como RegisteredProductAttachmentFolder cuando se crea el producto", async () => {
    const postEntity = vi
      .fn()
      .mockResolvedValueOnce({ ObjectID: "NEWOBJ", ID: "420999" })
      .mockResolvedValue({});
    const client = mockClient({ postEntity });

    await resolveRegisteredProduct({ ...input, fotos: [fakeFoto1, fakeFoto2] }, client);

    expect(postEntity).toHaveBeenCalledTimes(3);
    const [urlFoto1, bodyFoto1] = postEntity.mock.calls[1] as [string, Record<string, unknown>];
    expect(urlFoto1).toContain("RegisteredProductAttachmentFolderCollection");
    expect(bodyFoto1).toEqual({
      RegisteredProductID: "420999",
      CategoryCode: "2",
      TypeCode: "10011",
      MimeType: "image/jpeg",
      Name: "foto-1.jpg",
      Binary: "AAAA",
    });
    const [, bodyFoto2] = postEntity.mock.calls[2] as [string, Record<string, unknown>];
    expect(bodyFoto2.MimeType).toBe("image/png");
    expect(bodyFoto2.Binary).toBe("BBBB");
  });

  it("sube fotos tambien cuando el producto ya existia", async () => {
    const postEntity = vi.fn().mockResolvedValue({});
    const client = mockClient({
      getCollection: vi.fn().mockResolvedValue([{ ObjectID: "OBJ1", ID: "420434", zaIDdeSerieFSM_KUT: "TDM5524083854" }]),
      postEntity,
    });

    await resolveRegisteredProduct({ ...input, fotos: [fakeFoto1] }, client);

    expect(postEntity).toHaveBeenCalledTimes(1);
    const [url, body] = postEntity.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toContain("RegisteredProductAttachmentFolderCollection");
    expect(body.RegisteredProductID).toBe("420434");
  });

  it("no sube nada si no hay fotos", async () => {
    const postEntity = vi.fn().mockResolvedValue({ ObjectID: "NEWOBJ", ID: "420999" });
    const client = mockClient({ postEntity });

    await resolveRegisteredProduct(input, client);

    expect(postEntity).toHaveBeenCalledTimes(1);
  });
});
