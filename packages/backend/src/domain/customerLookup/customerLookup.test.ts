import type { IC4CODataClient } from "@cerocontacto/c4c-client";
import { describe, expect, it, vi } from "vitest";
import { lookupIndividual } from "./individual.js";

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
});
