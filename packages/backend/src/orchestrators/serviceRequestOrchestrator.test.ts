import { C4CError, type IC4CODataClient } from "@cerocontacto/c4c-client";
import type { ServiceRequestSubmission } from "@cerocontacto/shared";
import { describe, expect, it, vi } from "vitest";
import { runServiceRequestOrchestration } from "./serviceRequestOrchestrator.js";

const direccion = {
  departamento: "15",
  provincia: "128",
  distrito: "1254",
  codigoPostal: "07021",
  direccion: "AV. EL SOL",
  numero: "555",
  referencia: "Frente al parque",
};

const submission: ServiceRequestSubmission = {
  tipoDocumento: "DNI",
  numeroDocumento: "15619884",
  nombres: "ALVARO MIGUEL",
  apellidos: "SEBASTIANI RUBIO",
  telefono: "+51942568111",
  email: "cliente@example.com",
  direccion,
  productos: [{ numeroSerie: "TDM5524083854", productId: "10054511" }],
  fechaVisita: "2026-07-20",
  medioContacto: "whatsapp",
  lugarCompra: "SODIMAC PERU S.A.",
  consentimiento: true,
  captchaToken: "token-123",
};

const region = { zRegRegin: "SOLE-ADICIONALES-LIMA", zRegcode: "LIMA_SOLE-ADICIONALES-LIMA_15063", zRegid: "776679E1" };
const candidate = { ObjectID: "OBJ-A", zCupIdEmpresa: "1306EXT-3", zCupPrioridadNEw: 1, zCupDepart: "15", zCupactivo: true };

function clientFromRouter(router: (path: string) => Promise<unknown[]>, postEntity = vi.fn()): IC4CODataClient {
  return {
    getCollection: vi.fn(router) as unknown as IC4CODataClient["getCollection"],
    postEntity,
    patch: vi.fn(),
  };
}

/** Simula un cliente existente (Caso 4) con producto ya registrado y cupo disponible. */
function happyPathRouter(path: string): Promise<unknown[]> {
  if (path.includes("IndividualCustomerTaxNumberCollection")) {
    return Promise.resolve([{ ParentObjectID: "CLIOBJ", CustomerID: "1035063" }]);
  }
  if (path.includes("IndividualCustomerCollection")) {
    return Promise.resolve([{ ObjectID: "CLIOBJ", CustomerID: "1035063", StateCode: "15", StreetPostalCode: "07021" }]);
  }
  if (path.includes("RegisteredProductCollection")) {
    return Promise.resolve([{ ObjectID: "PRODOBJ", ID: "420434", zaIDdeSerieFSM_KUT: "TDM5524083854" }]);
  }
  if (path.includes("MaterialSalesProcessInformationCollection")) return Promise.resolve([{ ProductGroup2: "M74" }]);
  if (path.includes("BO_RegionRootCollection")) return Promise.resolve([region]);
  if (path.includes("BO_CuposEmpresaRootCollection") && !path.includes("(")) return Promise.resolve([candidate]);
  if (path.includes("CuposTipoServicio")) return Promise.resolve([{ zIDTipoServicio: "CA_1" }]);
  if (path.includes("CuposGrupoMaterial")) return Promise.resolve([{ zCupIdGrupoMaterial: "M74" }]);
  if (path.includes("CuposEmpresaFecha")) return Promise.resolve([{ zCupFechLunes: true }]);
  if (path.includes("BO_CupoPorAreaRootCollection")) {
    return Promise.resolve([{ zCantidadDisponible: 5, zIdRegistro: "REG-A" }]);
  }
  return Promise.resolve([]);
}

describe("runServiceRequestOrchestration", () => {
  it("crea el ticket cuando todos los pasos tienen exito", async () => {
    const postEntity = vi.fn().mockResolvedValue({ ObjectID: "TICKETOBJ", ID: "138320" });
    const client = clientFromRouter(happyPathRouter, postEntity);

    const result = await runServiceRequestOrchestration(submission, client);

    expect(result).toEqual({ status: "Completed", ticketIds: ["138320"] });
    const ticketCall = postEntity.mock.calls.find(
      ([path]) => (path as string).includes("ServiceRequestCollection") && !(path as string).includes("TextCollection"),
    ) as [string, Record<string, unknown>];
    const [, ticketBody] = ticketCall;
    expect(ticketBody.BuyerPartyID).toBe("1035063");
    expect(ticketBody.InstallationPointID).toBe("420434");
    expect(ticketBody.zIDEmpresa_SDK).toBe("1306EXT-3");
    expect(ticketBody.zIDRegistroCupoArea_SDK).toBe("REG-A");

    const noteCall = postEntity.mock.calls.find(([path]) => (path as string).includes("ServiceRequestTextCollection")) as [
      string,
      Record<string, unknown>,
    ];
    expect(noteCall[1].TypeCode).toBe("10004");
    expect(noteCall[1].Text).toContain("Medio de contacto preferido: WhatsApp");
    expect(noteCall[1].Text).toContain("Lugar de compra: SODIMAC PERU S.A.");
  });

  it("combo multi-producto: crea un producto registrado y un ticket por cada item, con el mismo cupo/contratista", async () => {
    const comboSubmission: ServiceRequestSubmission = {
      ...submission,
      productos: [
        { numeroSerie: "SERIE-COCINA", productId: "10054511" },
        { numeroSerie: "SERIE-HORNO", productId: "10054512" },
        { numeroSerie: "SERIE-CAMPANA", productId: "10054513" },
      ],
    };

    const postEntity = vi.fn(async (path: string, body: unknown) => {
      const b = body as Record<string, unknown>;
      if (path.includes("RegisteredProductCollection")) {
        const serie = b.zaIDdeSerieFSM_KUT as string;
        return { ObjectID: `OBJ-${serie}`, ID: `IP-${serie}` };
      }
      if (path.includes("ServiceRequestCollection")) {
        return { ObjectID: `TICKETOBJ-${b.InstallationPointID}`, ID: `TICKET-${b.InstallationPointID}` };
      }
      throw new Error(`POST inesperado en el test: ${path}`);
    });

    const client = clientFromRouter((path) => {
      // Ningun producto existe todavia -> los 3 se crean.
      if (path.includes("RegisteredProductCollection")) return Promise.resolve([]);
      return happyPathRouter(path);
    }, postEntity);

    const result = await runServiceRequestOrchestration(comboSubmission, client);

    expect(result).toEqual({
      status: "Completed",
      ticketIds: ["TICKET-IP-SERIE-COCINA", "TICKET-IP-SERIE-HORNO", "TICKET-IP-SERIE-CAMPANA"],
    });

    const registeredProductCalls = postEntity.mock.calls.filter(([path]) => (path as string).includes("RegisteredProductCollection"));
    expect(registeredProductCalls).toHaveLength(3);

    const ticketCalls = postEntity.mock.calls.filter(
      ([path]) => (path as string).includes("ServiceRequestCollection") && !(path as string).includes("TextCollection"),
    );
    expect(ticketCalls).toHaveLength(3);
    for (const [, body] of ticketCalls) {
      const b = body as Record<string, unknown>;
      expect(b.zIDEmpresa_SDK).toBe("1306EXT-3");
      expect(b.zIDRegistroCupoArea_SDK).toBe("REG-A");
    }
  });

  it("devuelve Failed con mensaje traducido si el motor de cupos no encuentra capacidad", async () => {
    const client = clientFromRouter((path) => {
      if (path.includes("BO_CupoPorAreaRootCollection")) return Promise.resolve([{ zCantidadDisponible: 0, zIdRegistro: "X" }]);
      return happyPathRouter(path);
    });

    const result = await runServiceRequestOrchestration(submission, client);

    expect(result).toEqual({
      status: "Failed",
      errorMessage: "No hay cupos disponibles para la fecha solicitada. Por favor intenta con otra fecha.",
    });
  });

  it("traduce un C4CError de regla de negocio (400 ABSL) a un Failed legible", async () => {
    const client = clientFromRouter(
      () => Promise.reject(new C4CError("Cupos agotados para los valores seleccionados", 400, { businessMessage: "Cupos agotados para los valores seleccionados" })),
    );

    const result = await runServiceRequestOrchestration(submission, client);

    expect(result.status).toBe("Failed");
    expect((result as { errorMessage: string }).errorMessage).toContain("Cupos agotados");
  });

  it("propaga errores no relacionados a reglas de negocio (ej. 401/5xx)", async () => {
    const client = clientFromRouter(() => Promise.reject(new C4CError("Timeout", 504, { isTransient: true })));

    await expect(runServiceRequestOrchestration(submission, client)).rejects.toThrow("Timeout");
  });
});
