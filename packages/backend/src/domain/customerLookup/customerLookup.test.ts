import type { IC4CODataClient } from "@cerocontacto/c4c-client";
import { describe, expect, it, vi } from "vitest";
import { lookupIndividual } from "./individual.js";
import { lookupCustomer } from "./index.js";
import { lookupEmpresa } from "./empresa.js";

function mockClient(overrides: Partial<IC4CODataClient> = {}): IC4CODataClient {
  return {
    getCollection: vi.fn().mockResolvedValue([]),
    postEntity: vi.fn(),
    patch: vi.fn(),
    ...overrides,
  };
}

describe("lookupIndividual", () => {
  it("cliente encontrado con direccion completa: devuelve found:true y todos los datos", async () => {
    const getCollection = vi
      .fn()
      .mockResolvedValueOnce([{ ParentObjectID: "OBJ1", CustomerID: "1035063" }])
      .mockResolvedValueOnce([{ ObjectID: "OBJ1", CustomerID: "1035063", FirstName: "ALVARO", LastName: "SEBASTIANI", Phone: "+51942568111", Email: "cliente@example.com" }])
      .mockResolvedValueOnce([
        {
          StateCode: "15",
          zIDProvinciacontent_SDK: "128",
          zIDDistritocontent_SDK: "1254",
          Street: "AV. EL SOL",
          HouseNumber: "555",
          AddressLine5: "Frente al parque",
          StreetPostalCode: "07021",
        },
      ]);
    const client = mockClient({ getCollection });

    const result = await lookupIndividual("DNI", "15619884", client);

    expect(result).toEqual({
      found: true,
      datos: {
        nombres: "ALVARO",
        apellidos: "SEBASTIANI",
        telefono: "+51942568111",
        email: "cliente@example.com",
        direccion: {
          departamento: "15",
          provincia: "128",
          distrito: "1254",
          direccion: "AV. EL SOL",
          numero: "555",
          referencia: "Frente al parque",
          codigoPostal: "07021",
        },
      },
    });
    expect(client.postEntity).not.toHaveBeenCalled();
  });

  it("cliente encontrado sin direccion registrada: datos.direccion queda vacio", async () => {
    const getCollection = vi
      .fn()
      .mockResolvedValueOnce([{ ParentObjectID: "OBJ2", CustomerID: "1035064" }])
      .mockResolvedValueOnce([{ ObjectID: "OBJ2", CustomerID: "1035064", FirstName: "JUAN", LastName: "PEREZ", Phone: "+51999999999", Email: "juan@example.com" }])
      .mockResolvedValueOnce([]);
    const client = mockClient({ getCollection });

    const result = await lookupIndividual("DNI", "20000001", client);

    expect(result.found).toBe(true);
    expect(result.datos?.direccion).toEqual({});
  });

  it("cliente no encontrado: devuelve found:false sin consultar mas nada", async () => {
    const getCollection = vi.fn().mockResolvedValueOnce([]);
    const client = mockClient({ getCollection });

    const result = await lookupIndividual("DNI", "99999999", client);

    expect(result).toEqual({ found: false });
    expect(getCollection).toHaveBeenCalledTimes(1);
  });

  it("CE usa TaxTypeCode '5' en el filtro (igual que customerResolution)", async () => {
    const getCollection = vi.fn().mockResolvedValueOnce([]);
    const client = mockClient({ getCollection });

    await lookupIndividual("CE", "AB123456", client);

    const filterUrl = (getCollection.mock.calls[0] as [string])[0];
    expect(decodeURIComponent(filterUrl)).toContain("TaxTypeCode eq '5'");
  });

  it("usa Mobile como telefono cuando Phone viene vacio", async () => {
    // Caso real de produccion (cliente 1125569, 2026-08-11): Phone="" y el
    // numero cargado solo en Mobile dejaba el campo Telefono en blanco.
    const getCollection = vi
      .fn()
      .mockResolvedValueOnce([{ ParentObjectID: "OBJ1", CustomerID: "1125569" }])
      .mockResolvedValueOnce([{ ObjectID: "OBJ1", CustomerID: "1125569", Phone: "", Mobile: "+51 960 560 064" }])
      .mockResolvedValueOnce([]);

    const result = await lookupIndividual("DNI", "70333796", mockClient({ getCollection }));

    expect(result.datos?.telefono).toBe("+51 960 560 064");
  });

  it("prefiere Phone sobre Mobile cuando ambos tienen valor", async () => {
    const getCollection = vi
      .fn()
      .mockResolvedValueOnce([{ ParentObjectID: "OBJ1", CustomerID: "1035063" }])
      .mockResolvedValueOnce([{ ObjectID: "OBJ1", CustomerID: "1035063", Phone: "999111222", Mobile: "888333444" }])
      .mockResolvedValueOnce([]);

    const result = await lookupIndividual("DNI", "15619884", mockClient({ getCollection }));

    expect(result.datos?.telefono).toBe("999111222");
  });

  it("devuelve telefono vacio si ni Phone ni Mobile tienen valor", async () => {
    const getCollection = vi
      .fn()
      .mockResolvedValueOnce([{ ParentObjectID: "OBJ1", CustomerID: "1035063" }])
      .mockResolvedValueOnce([{ ObjectID: "OBJ1", CustomerID: "1035063", Phone: "  ", Mobile: "" }])
      .mockResolvedValueOnce([]);

    const result = await lookupIndividual("DNI", "15619884", mockClient({ getCollection }));

    expect(result.datos?.telefono).toBe("");
  });
});

describe("lookupEmpresa", () => {
  it("empresa encontrada: devuelve found:true con razonSocial", async () => {
    const getCollection = vi
      .fn()
      .mockResolvedValueOnce([{ ParentObjectID: "OBJ1", AccountID: "1038018" }])
      .mockResolvedValueOnce([{ ObjectID: "OBJ1", AccountID: "1038018", Name: "SERVICIOS MEDICOS M'VAPE S.A.C.", Phone: "+51942568111", Email: "empresa@example.com" }])
      .mockResolvedValueOnce([{ StateCode: "15", StreetPostalCode: "07001" }]);
    const client = mockClient({ getCollection });

    const result = await lookupEmpresa("20525512348", client);

    expect(result.found).toBe(true);
    expect(result.datos?.razonSocial).toBe("SERVICIOS MEDICOS M'VAPE S.A.C.");
    expect(result.datos?.direccion).toEqual({ departamento: "15", codigoPostal: "07001" });
    expect(client.postEntity).not.toHaveBeenCalled();
  });

  it("empresa no encontrada: devuelve found:false", async () => {
    const client = mockClient({ getCollection: vi.fn().mockResolvedValueOnce([]) });

    const result = await lookupEmpresa("20999999999", client);

    expect(result).toEqual({ found: false });
  });

  it("usa Mobile como telefono cuando Phone viene vacio", async () => {
    const getCollection = vi
      .fn()
      .mockResolvedValueOnce([{ ParentObjectID: "OBJ1", AccountID: "1038018" }])
      .mockResolvedValueOnce([{ ObjectID: "OBJ1", AccountID: "1038018", Name: "EMPRESA S.A.C.", Phone: "", Mobile: "987654321" }])
      .mockResolvedValueOnce([]);

    const result = await lookupEmpresa("20525512348", mockClient({ getCollection }));

    expect(result.datos?.telefono).toBe("987654321");
  });
});

describe("lookupCustomer (dispatcher)", () => {
  it("RUC despacha a lookupEmpresa", async () => {
    const getCollection = vi.fn().mockResolvedValueOnce([]);
    const client = mockClient({ getCollection });
    const result = await lookupCustomer("RUC", "20525512348", client);
    expect(result).toEqual({ found: false });

    const filterUrl = (getCollection.mock.calls[0] as [string])[0];
    expect(decodeURIComponent(filterUrl)).toContain("CorporateAccountTaxNumberCollection");
  });

  it("DNI despacha a lookupIndividual", async () => {
    const getCollection = vi.fn().mockResolvedValueOnce([]);
    const client = mockClient({ getCollection });
    const result = await lookupCustomer("DNI", "15619884", client);
    expect(result).toEqual({ found: false });

    const filterUrl = (getCollection.mock.calls[0] as [string])[0];
    expect(decodeURIComponent(filterUrl)).toContain("IndividualCustomerTaxNumberCollection");
  });
});
