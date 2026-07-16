import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockOrchestration, mockRecordSubmission } = vi.hoisted(() => ({
  mockOrchestration: vi.fn(),
  mockRecordSubmission: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../orchestrators/serviceRequestOrchestrator.js", () => ({
  runServiceRequestOrchestration: mockOrchestration,
}));

vi.mock("../infra/auditLog.js", () => ({
  recordSubmission: mockRecordSubmission,
}));

import { handleSubmitServiceRequest } from "./submitServiceRequest.js";

const direccion = {
  departamento: "15",
  provincia: "128",
  distrito: "1260",
  codigoPostal: "15314",
  direccion: "AV. EL SOL",
  numero: "555",
  referencia: "Frente al parque",
};

const validBody = {
  tipoDocumento: "DNI",
  numeroDocumento: "15619884",
  nombres: "ALVARO MIGUEL",
  apellidos: "SEBASTIANI RUBIO",
  telefono: "+51942568111",
  email: "cliente@example.com",
  direccion,
  productos: [{ numeroSerie: "TDM5524083854", productId: "10054511" }],
  fechaVisita: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
  medioContacto: "whatsapp",
  lugarCompra: "SODIMAC PERU S.A.",
  consentimiento: true,
  captchaToken: "token-123",
};

function fakeLog() {
  return { error: vi.fn() };
}

describe("handleSubmitServiceRequest", () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    process.env.C4C_BASE_URL = "https://qa.example.com/sap/c4c/odata";
    process.env.C4C_USER = "_SYSODATA";
    process.env.C4C_PASSWORD = "secret";
  });

  afterEach(() => {
    process.env = { ...envBackup };
    mockOrchestration.mockReset();
    mockRecordSubmission.mockReset();
    mockRecordSubmission.mockResolvedValue(undefined);
  });

  it("devuelve 400 con detalles cuando el DTO no pasa la validacion Zod", async () => {
    const res = await handleSubmitServiceRequest({ ...validBody, numeroDocumento: "123" }, fakeLog());
    expect(res.httpStatus).toBe(400);
    expect(res.body).toHaveProperty("details");
  });

  it("devuelve 201 con los ticketIds y registra la auditoria cuando la orquestacion se completa", async () => {
    mockOrchestration.mockResolvedValue({ status: "Completed", ticketIds: ["138401"] });

    const res = await handleSubmitServiceRequest(validBody, fakeLog());

    expect(res.httpStatus).toBe(201);
    expect(res.body).toEqual({ status: "Completed", ticketIds: ["138401"] });
    expect(mockRecordSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ numeroDocumento: validBody.numeroDocumento }),
      { status: "Completed", ticketIds: ["138401"] },
    );
  });

  it("devuelve 200 con errorMessage cuando la orquestacion falla de forma controlada", async () => {
    mockOrchestration.mockResolvedValue({ status: "Failed", errorMessage: "No hay cupos disponibles." });

    const res = await handleSubmitServiceRequest(validBody, fakeLog());

    expect(res.httpStatus).toBe(200);
    expect(res.body).toEqual({ status: "Failed", errorMessage: "No hay cupos disponibles." });
    expect(mockRecordSubmission).toHaveBeenCalledWith(expect.anything(), {
      status: "Failed",
      errorMessage: "No hay cupos disponibles.",
    });
  });

  it("devuelve 502 y registra un Error de auditoria si la orquestacion lanza una excepcion no controlada", async () => {
    mockOrchestration.mockRejectedValue(new Error("network down"));

    const res = await handleSubmitServiceRequest(validBody, fakeLog());

    expect(res.httpStatus).toBe(502);
    expect(mockRecordSubmission).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "Error", errorDetail: expect.stringContaining("network down") }),
    );
  });

  it("devuelve 500 si faltan las variables de entorno de C4C", async () => {
    delete process.env.C4C_BASE_URL;

    const res = await handleSubmitServiceRequest(validBody, fakeLog());

    expect(res.httpStatus).toBe(500);
  });

  it("no interrumpe la respuesta al cliente si falla la escritura de auditoria", async () => {
    mockOrchestration.mockResolvedValue({ status: "Completed", ticketIds: ["1"] });
    mockRecordSubmission.mockRejectedValueOnce(new Error("sql down"));
    const log = fakeLog();

    const res = await handleSubmitServiceRequest(validBody, log);

    expect(res.httpStatus).toBe(201);
    expect(log.error).toHaveBeenCalledWith("submitServiceRequest_audit_log_failed", expect.any(Error));
  });
});
