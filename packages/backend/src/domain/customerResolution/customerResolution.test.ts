import type { IC4CODataClient } from "@cerocontacto/c4c-client";
import type { Address } from "@cerocontacto/shared";
import { describe, expect, it, vi } from "vitest";
import { resolveCustomer } from "./index.js";
import type { EmpresaInput, IndividualInput } from "./types.js";

const direccion: Address = {
  departamento: "15",
  provincia: "128",
  distrito: "1254",
  codigoPostal: "07021",
  direccion: "AV. EL SOL",
  numero: "555",
  referencia: "Frente al parque",
};

function mockClient(overrides: Partial<IC4CODataClient> = {}): IC4CODataClient {
  return {
    getCollection: vi.fn().mockResolvedValue([]),
    postEntity: vi.fn(),
    patch: vi.fn(),
    ...overrides,
  };
}

describe("resolveCustomer - Empresa (RUC)", () => {
  const input: EmpresaInput = {
    tipoDocumento: "RUC",
    numeroDocumento: "20525512348",
    razonSocial: "SERVICIOS MEDICOS M'VAPE S.A.C.",
    direccion,
  };

  it("Caso 2: cliente existente - no crea nada, resuelve region/postal del CorporateAccount", async () => {
    const client = mockClient({
      getCollection: vi
        .fn()
        .mockResolvedValueOnce([{ ParentObjectID: "OBJ1", AccountID: "1038018" }])
        .mockResolvedValueOnce([{ ObjectID: "OBJ1", AccountID: "1038018", StateCode: "15", StreetPostalCode: "07001" }]),
    });

    const result = await resolveCustomer(input, client);

    expect(result).toEqual({
      clientKind: "empresa",
      buyerPartyId: "1038018",
      clienteObjectId: "OBJ1",
      wasCreated: false,
      regionCode: "15",
      postalCode: "07001",
    });
    expect(client.postEntity).not.toHaveBeenCalled();
  });

  it("Caso 1: cliente nuevo - crea cuenta y direccion, usa region/postal del formulario", async () => {
    const postEntity = vi
      .fn()
      .mockResolvedValueOnce({ ObjectID: "NEWOBJ", AccountID: "1038022" })
      .mockResolvedValueOnce({ ObjectID: "ADDR1" });
    const client = mockClient({ postEntity });

    const result = await resolveCustomer(input, client);

    expect(result).toEqual({
      clientKind: "empresa",
      buyerPartyId: "1038022",
      clienteObjectId: "NEWOBJ",
      wasCreated: true,
      regionCode: "15",
      postalCode: "07021",
    });
    expect(postEntity).toHaveBeenCalledTimes(2);
    const [createUrl, createBody] = postEntity.mock.calls[0] as [string, Record<string, unknown>];
    expect(createUrl).toContain("CorporateAccountCollection");
    expect((createBody.CorporateAccountTaxNumber as Array<{ TaxID: string }>)[0]?.TaxID).toBe("20525512348");
  });
});

describe("resolveCustomer - Individual DNI", () => {
  const input: IndividualInput = {
    tipoDocumento: "DNI",
    numeroDocumento: "15619884",
    nombres: "ALVARO MIGUEL",
    apellidos: "SEBASTIANI RUBIO",
    direccion,
  };

  it("Caso 3: cliente nuevo - usa TaxTypeCode '2' y crea IndividualCustomer", async () => {
    const postEntity = vi
      .fn()
      .mockResolvedValueOnce({ ObjectID: "NEWOBJ", CustomerID: "1035063" })
      .mockResolvedValueOnce({ ObjectID: "ADDR1" });
    const client = mockClient({ postEntity });

    const result = await resolveCustomer(input, client);

    expect(result.clientKind).toBe("individual");
    expect(result.buyerPartyId).toBe("1035063");
    expect(result.wasCreated).toBe(true);
    const [, createBody] = postEntity.mock.calls[0] as [string, Record<string, unknown>];
    expect((createBody.IndividualCustomerTaxNumber as Array<{ TaxTypeCode: string }>)[0]?.TaxTypeCode).toBe("2");
  });

  it("Caso 4: cliente existente - no crea nada", async () => {
    const client = mockClient({
      getCollection: vi
        .fn()
        .mockResolvedValueOnce([{ ParentObjectID: "OBJ2", CustomerID: "1035063" }])
        .mockResolvedValueOnce([{ ObjectID: "OBJ2", CustomerID: "1035063", StateCode: "15", StreetPostalCode: "07001" }]),
    });

    const result = await resolveCustomer(input, client);

    expect(result.wasCreated).toBe(false);
    expect(client.postEntity).not.toHaveBeenCalled();
  });
});

describe("resolveCustomer - Individual CE (Carne de Extranjeria)", () => {
  const input: IndividualInput = {
    tipoDocumento: "CE",
    numeroDocumento: "AB123456",
    nombres: "JOHN",
    apellidos: "SMITH",
    direccion,
  };

  it("usa TaxTypeCode '5' (ID extranjero, confirmado via $metadata de C4C)", async () => {
    const getCollection = vi.fn().mockResolvedValue([]);
    const postEntity = vi
      .fn()
      .mockResolvedValueOnce({ ObjectID: "NEWOBJ", CustomerID: "1040000" })
      .mockResolvedValueOnce({ ObjectID: "ADDR1" });
    const client = mockClient({ getCollection, postEntity });

    await resolveCustomer(input, client);

    const filterUrl = (getCollection.mock.calls[0] as [string])[0];
    expect(decodeURIComponent(filterUrl)).toContain("TaxTypeCode eq '5'");
    const [, createBody] = postEntity.mock.calls[0] as [string, Record<string, unknown>];
    expect((createBody.IndividualCustomerTaxNumber as Array<{ TaxTypeCode: string }>)[0]?.TaxTypeCode).toBe("5");
  });
});
