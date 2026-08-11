import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockOrchestration, mockRecordSubmission, mockSendMail } = vi.hoisted(() => ({
  mockOrchestration: vi.fn(),
  mockRecordSubmission: vi.fn().mockResolvedValue(undefined),
  mockSendMail: vi.fn().mockResolvedValue(true),
}));

vi.mock("../orchestrators/serviceRequestOrchestrator.js", () => ({
  runServiceRequestOrchestration: mockOrchestration,
}));

vi.mock("../infra/auditLog.js", () => ({
  recordSubmission: mockRecordSubmission,
}));

vi.mock("../infra/mailer.js", () => ({
  sendTicketConfirmation: mockSendMail,
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
  telefono: "942568111",
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
    mockSendMail.mockReset();
    mockSendMail.mockResolvedValue(true);
  });

  it("envia el correo de confirmacion con los tickets creados", async () => {
    mockOrchestration.mockResolvedValue({ status: "Completed", ticketIds: ["1401544"] });

    await handleSubmitServiceRequest(validBody, fakeLog());

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        submission: expect.objectContaining({ email: validBody.email }),
        ticketIds: ["1401544"],
      }),
      expect.anything(),
    );
  });

  it("en resultado parcial el correo lleva tambien los productos fallidos", async () => {
    mockOrchestration.mockResolvedValue({
      status: "Partial",
      ticketIds: ["1401544"],
      productosFallidos: ["10054512"],
      errorMessage: "No pudimos completar tu solicitud: Cupos agotados",
    });

    await handleSubmitServiceRequest(validBody, fakeLog());

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({ ticketIds: ["1401544"], productosFallidos: ["10054512"] }),
      expect.anything(),
    );
  });

  it("no envia correo si la solicitud fallo por completo", async () => {
    mockOrchestration.mockResolvedValue({ status: "Failed", errorMessage: "Cupos agotados" });

    await handleSubmitServiceRequest(validBody, fakeLog());

    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("un fallo del correo no altera la respuesta al cliente", async () => {
    // El ticket ya existe en C4C: perder el correo es una degradacion, nunca
    // debe convertir un 201 en un error.
    mockOrchestration.mockResolvedValue({ status: "Completed", ticketIds: ["1401544"] });
    mockSendMail.mockRejectedValue(new Error("graph caido"));

    const res = await handleSubmitServiceRequest(validBody, fakeLog());

    expect(res.httpStatus).toBe(201);
    expect(res.body).toEqual({ status: "Completed", ticketIds: ["1401544"] });
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

  it("devuelve 201 con tickets y productos fallidos cuando la orquestacion es parcial", async () => {
    mockOrchestration.mockResolvedValue({
      status: "Partial",
      ticketIds: ["138401"],
      productosFallidos: ["10054512"],
      errorMessage: "No pudimos completar tu solicitud: Cupos agotados",
    });

    const res = await handleSubmitServiceRequest(validBody, fakeLog());

    expect(res.httpStatus).toBe(201);
    expect(res.body).toEqual({
      status: "Partial",
      ticketIds: ["138401"],
      productosFallidos: ["10054512"],
      errorMessage: "No pudimos completar tu solicitud: Cupos agotados",
    });
    expect(mockRecordSubmission).toHaveBeenCalledWith(expect.anything(), {
      status: "Partial",
      ticketIds: ["138401"],
      errorMessage: "No pudimos completar tu solicitud: Cupos agotados",
    });
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
