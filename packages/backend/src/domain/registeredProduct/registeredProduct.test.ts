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

/**
 * Cliente con enrutado por path: la busqueda de candidatos y la de propiedad
 * son dos consultas distintas, asi que un unico mockResolvedValue ya no basta.
 */
function clientFromRouter(
  router: (path: string) => unknown[],
  postEntity = vi.fn().mockResolvedValue({ ObjectID: "NEWOBJ", ID: "420999" }),
): IC4CODataClient {
  return {
    getCollection: vi.fn(async (path: string) => router(path)) as unknown as IC4CODataClient["getCollection"],
    postEntity,
    patch: vi.fn(),
  };
}

/** Router de un candidato propio: misma direccion+modelo y del mismo cliente. */
function routerCandidatoPropio(candidato: Record<string, unknown>) {
  return (path: string): unknown[] =>
    path.includes("PartyInformation") ? [{ ParentObjectID: candidato.ObjectID }] : [candidato];
}

describe("resolveRegisteredProduct", () => {
  it("busca por modelo y direccion, nunca por la serie sola", async () => {
    const getCollection = vi.fn().mockResolvedValue([]);
    const postEntity = vi.fn().mockResolvedValue({ ObjectID: "NEWOBJ", ID: "420999" });
    const client = mockClient({ getCollection, postEntity });

    await resolveRegisteredProduct(input, client);

    const decoded = decodeURIComponent((getCollection.mock.calls[0] as [string])[0]);
    expect(decoded).toContain("ProductID eq '10054511'");
    expect(decoded).toContain("Street eq 'AV. EL SOL'");
    expect(decoded).toContain("PostalCode eq '07021'");
    expect(decoded).toContain("House eq '555'");
    expect(decoded).not.toContain("zaIDdeSerieFSM_KUT eq");
  });

  it("crea uno nuevo sin consultar la propiedad cuando no hay candidatos en esa direccion", async () => {
    const getCollection = vi.fn().mockResolvedValue([]);
    const postEntity = vi.fn().mockResolvedValue({ ObjectID: "NEWOBJ", ID: "420999" });
    const client = mockClient({ getCollection, postEntity });

    const result = await resolveRegisteredProduct(input, client);

    expect(result.wasCreated).toBe(true);
    expect(getCollection).toHaveBeenCalledTimes(1);
  });

  it("NO reutiliza un producto que pertenece a otro cliente", async () => {
    // Reproduce el bug real: la serie "123" existe en C4C pero es de otro dueño.
    const postEntity = vi.fn().mockResolvedValue({ ObjectID: "NEWOBJ", ID: "420999" });
    const client = clientFromRouter(
      (path) =>
        path.includes("PartyInformation")
          ? [{ ParentObjectID: "OBJ-DE-OTRO-CLIENTE" }]
          : [{ ObjectID: "OBJ-AJENO", ID: "506202", zaIDdeSerieFSM_KUT: "123" }],
      postEntity,
    );

    const result = await resolveRegisteredProduct({ ...input, numeroSerie: "123" }, client);

    expect(result).toEqual({ installationPointId: "420999", objectId: "NEWOBJ", wasCreated: true });
  });

  it("reutiliza el producto propio cuando ambas series estan vacias", async () => {
    // Regresion del bug de produccion: 3 productos identicos creados por
    // reintentos, todos con serie vacia (cliente 1125569, 2026-08-03).
    const postEntity = vi.fn();
    const client = clientFromRouter(
      routerCandidatoPropio({ ObjectID: "PROPIO", ID: "689472", zaIDdeSerieFSM_KUT: "" }),
      postEntity,
    );

    const result = await resolveRegisteredProduct({ ...input, numeroSerie: undefined }, client);

    expect(result).toEqual({ installationPointId: "689472", objectId: "PROPIO", wasCreated: false });
    expect(postEntity).not.toHaveBeenCalled();
  });

  it("crea uno nuevo si el candidato propio tiene una serie distinta a la ingresada", async () => {
    const postEntity = vi.fn().mockResolvedValue({ ObjectID: "NEWOBJ", ID: "420999" });
    const client = clientFromRouter(
      routerCandidatoPropio({ ObjectID: "PROPIO", ID: "111", zaIDdeSerieFSM_KUT: "SERIE-VIEJA" }),
      postEntity,
    );

    const result = await resolveRegisteredProduct({ ...input, numeroSerie: "SERIE-NUEVA" }, client);

    expect(result.wasCreated).toBe(true);
  });

  it("prefiere el candidato propio cuya serie coincide exactamente", async () => {
    const candidatos = [
      { ObjectID: "P1", ID: "111", zaIDdeSerieFSM_KUT: "" },
      { ObjectID: "P2", ID: "222", zaIDdeSerieFSM_KUT: "TDM5524083854" },
    ];
    const client = clientFromRouter((path) =>
      path.includes("PartyInformation") ? [{ ParentObjectID: "P1" }, { ParentObjectID: "P2" }] : candidatos,
    );

    const result = await resolveRegisteredProduct(input, client);

    expect(result.installationPointId).toBe("222");
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

  it("sube fotos tambien cuando reutiliza un producto existente", async () => {
    const postEntity = vi.fn().mockResolvedValue({});
    const client = clientFromRouter(
      routerCandidatoPropio({ ObjectID: "PROPIO", ID: "420434", zaIDdeSerieFSM_KUT: "TDM5524083854" }),
      postEntity,
    );

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
