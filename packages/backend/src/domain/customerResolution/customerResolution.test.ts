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
  latitud: -12.0280400,
  longitud: -76.9896220,
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
    telefono: "+51942568111",
    telefono2: "+51987654321",
    email: "empresa@example.com",
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

  it("cuenta existente: actualiza en C4C la razon social/telefono/correo que cambiaron", async () => {
    const patch = vi.fn();
    const client = mockClient({
      patch,
      getCollection: vi
        .fn()
        .mockResolvedValueOnce([{ ParentObjectID: "OBJ1", AccountID: "1038018" }])
        .mockResolvedValueOnce([
          {
            ObjectID: "OBJ1",
            AccountID: "1038018",
            StateCode: "15",
            StreetPostalCode: "07001",
            Name: "SERVICIOS MEDICOS M'VAPE S.A.C.",
            Phone: "+51900000000",
            Mobile: "+51987654321",
            Email: "empresa@example.com",
          },
        ]),
    });

    await resolveCustomer(input, client);

    expect(patch).toHaveBeenCalledTimes(1);
    const [patchPath, patchBody] = patch.mock.calls[0] as [string, Record<string, unknown>];
    expect(patchPath).toContain("CorporateAccountCollection('OBJ1')");
    expect(patchBody).toEqual({ Mobile: "+51942568111", Phone: "+51987654321" });
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
        // Linea 1 -> Mobile ("Celular 1" en C4C); linea 2 -> Phone ("Celular 2").
    expect(createBody.Mobile).toBe("+51942568111");
    expect(createBody.Phone).toBe("+51987654321");
    expect(createBody.Email).toBe("empresa@example.com");
  });
});

describe("resolveCustomer - Individual DNI", () => {
  const input: IndividualInput = {
    tipoDocumento: "DNI",
    numeroDocumento: "15619884",
    nombres: "ALVARO MIGUEL",
    apellidos: "SEBASTIANI RUBIO",
    telefono: "+51942568111",
    email: "cliente@example.com",
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
        expect(createBody.Mobile).toBe("+51942568111");
    expect(createBody.Phone).toBe("");
    expect(createBody.Email).toBe("cliente@example.com");
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

  it("cliente existente: actualiza en C4C solo el nombre/telefono/correo que cambiaron", async () => {
    const patch = vi.fn();
    const client = mockClient({
      patch,
      getCollection: vi
        .fn()
        .mockResolvedValueOnce([{ ParentObjectID: "OBJ2", CustomerID: "1035063" }])
        .mockResolvedValueOnce([
          {
            ObjectID: "OBJ2",
            CustomerID: "1035063",
            StateCode: "15",
            StreetPostalCode: "07001",
            FirstName: "ALVARO MIGUEL",
            LastName: "SEBASTIANI RUBIO",
            Phone: "+51900000000",
            Email: "viejo@example.com",
          },
        ]),
    });

    await resolveCustomer(input, client);

    expect(patch).toHaveBeenCalledTimes(1);
    const [patchPath, patchBody] = patch.mock.calls[0] as [string, Record<string, unknown>];
    expect(patchPath).toContain("IndividualCustomerCollection('OBJ2')");
    // Telefono y correo cambiaron; los nombres son identicos, no se reenvian.
    expect(patchBody).toEqual({ Mobile: "+51942568111", Email: "cliente@example.com" });
  });

  it("cliente existente: no hace PATCH si los datos de contacto no cambiaron", async () => {
    const patch = vi.fn();
    const client = mockClient({
      patch,
      getCollection: vi
        .fn()
        .mockResolvedValueOnce([{ ParentObjectID: "OBJ2", CustomerID: "1035063" }])
        .mockResolvedValueOnce([
          {
            ObjectID: "OBJ2",
            CustomerID: "1035063",
            StateCode: "15",
            StreetPostalCode: "07001",
            FirstName: "ALVARO MIGUEL",
            LastName: "SEBASTIANI RUBIO",
            Mobile: "+51942568111",
            Email: "cliente@example.com",
          },
        ]),
    });

    await resolveCustomer(input, client);

    expect(patch).not.toHaveBeenCalled();
  });

  /**
   * Caso de migracion del cambio de mapeo (observacion 26): este cliente fue
   * creado con el mapeo viejo, que ponia el telefono principal en Phone. Al
   * volver a enviar el formulario, ese numero pasa a Mobile ("Celular 1") y
   * Phone debe quedar VACIO - si no, el mismo numero apareceria repetido en
   * "Celular 1" y "Celular 2".
   */
  it("cliente existente: mueve el telefono a Celular 1 sin dejarlo duplicado en Celular 2", async () => {
    const patch = vi.fn();
    const client = mockClient({
      patch,
      getCollection: vi
        .fn()
        .mockResolvedValueOnce([{ ParentObjectID: "OBJ2", CustomerID: "1035063" }])
        .mockResolvedValueOnce([
          {
            ObjectID: "OBJ2",
            CustomerID: "1035063",
            StateCode: "15",
            StreetPostalCode: "07001",
            FirstName: "ALVARO MIGUEL",
            LastName: "SEBASTIANI RUBIO",
            Phone: "+51942568111",
            Email: "cliente@example.com",
          },
        ]),
    });

    await resolveCustomer(input, client);

    const [, patchBody] = patch.mock.calls[0] as [string, Record<string, unknown>];
    expect(patchBody).toEqual({ Mobile: "+51942568111", Phone: "" });
  });

  /**
   * La regla general sigue en pie: un telefono2 ausente NO borra un segundo
   * telefono real ya registrado. Solo se limpia cuando quedaria duplicado.
   */
  it("cliente existente: un telefono2 ausente no borra un segundo telefono distinto", async () => {
    const patch = vi.fn();
    const client = mockClient({
      patch,
      getCollection: vi
        .fn()
        .mockResolvedValueOnce([{ ParentObjectID: "OBJ2", CustomerID: "1035063" }])
        .mockResolvedValueOnce([
          {
            ObjectID: "OBJ2",
            CustomerID: "1035063",
            StateCode: "15",
            StreetPostalCode: "07001",
            FirstName: "ALVARO MIGUEL",
            LastName: "SEBASTIANI RUBIO",
            Mobile: "+51942568111",
            Phone: "+51955555555",
            Email: "cliente@example.com",
          },
        ]),
    });

    await resolveCustomer(input, client);

    // Nada que cambiar: Celular 1 ya tiene la linea 1 y Celular 2 un numero real.
    expect(patch).not.toHaveBeenCalled();
  });

  it("cliente existente: si el PATCH de contacto falla, la solicitud sigue adelante", async () => {
    const client = mockClient({
      patch: vi.fn().mockRejectedValue(new Error("C4C 500")),
      getCollection: vi
        .fn()
        .mockResolvedValueOnce([{ ParentObjectID: "OBJ2", CustomerID: "1035063" }])
        .mockResolvedValueOnce([
          { ObjectID: "OBJ2", CustomerID: "1035063", StateCode: "15", StreetPostalCode: "07001", Email: "viejo@example.com" },
        ]),
    });

    const result = await resolveCustomer(input, client);

    expect(result.buyerPartyId).toBe("1035063");
    expect(result.wasCreated).toBe(false);
  });
});

describe("resolveCustomer - Individual CE (Carne de Extranjeria)", () => {
  const input: IndividualInput = {
    tipoDocumento: "CE",
    numeroDocumento: "AB123456",
    nombres: "JOHN",
    apellidos: "SMITH",
    telefono: "+51942568111",
    email: "john.smith@example.com",
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
