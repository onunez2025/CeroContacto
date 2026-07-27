import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockOrchestration } = vi.hoisted(() => ({ mockOrchestration: vi.fn() }));

vi.mock("./orchestrators/serviceRequestOrchestrator.js", () => ({
  runServiceRequestOrchestration: mockOrchestration,
}));

vi.mock("./infra/auditLog.js", () => ({
  recordSubmission: vi.fn().mockResolvedValue(undefined),
}));

const { mockGetFechasDisponibles } = vi.hoisted(() => ({ mockGetFechasDisponibles: vi.fn() }));

vi.mock("./domain/cuposEngine/index.js", () => ({
  getFechasDisponibles: mockGetFechasDisponibles,
}));

const { mockLookupCustomer } = vi.hoisted(() => ({ mockLookupCustomer: vi.fn() }));

vi.mock("./domain/customerLookup/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./domain/customerLookup/index.js")>();
  return { ...actual, lookupCustomer: mockLookupCustomer };
});

import { createApp } from "./app.js";

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

describe("createApp", () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    process.env.C4C_BASE_URL = "https://qa.example.com/sap/c4c/odata";
    process.env.C4C_USER = "_SYSODATA";
    process.env.C4C_PASSWORD = "secret";
  });

  afterEach(() => {
    process.env = { ...envBackup };
    mockOrchestration.mockReset();
    mockGetFechasDisponibles.mockReset();
    mockLookupCustomer.mockReset();
  });

  it("GET /health devuelve 200", async () => {
    const res = await request(createApp()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("POST /api/service-requests con JSON malformado devuelve 400", async () => {
    const res = await request(createApp())
      .post("/api/service-requests")
      .set("Content-Type", "application/json")
      .send("{esto no es json");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Cuerpo JSON invalido" });
  });

  it("POST /api/service-requests feliz devuelve 201 con ticketIds", async () => {
    mockOrchestration.mockResolvedValue({ status: "Completed", ticketIds: ["138401"] });

    const res = await request(createApp()).post("/api/service-requests").send(validBody);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ status: "Completed", ticketIds: ["138401"] });
  });

  it("GET /api/fechas-disponibles devuelve las fechas del motor de cupos", async () => {
    mockGetFechasDisponibles.mockResolvedValue(["2026-08-03", "2026-08-05"]);

    const res = await request(createApp()).get(
      "/api/fechas-disponibles?departamento=15&codigoPostal=07021&productos=10054511",
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ fechas: ["2026-08-03", "2026-08-05"] });
  });

  it("GET /api/fechas-disponibles sin parametros devuelve fechas vacias sin llamar a C4C", async () => {
    const res = await request(createApp()).get("/api/fechas-disponibles");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ fechas: [] });
    expect(mockGetFechasDisponibles).not.toHaveBeenCalled();
  });

  it("GET /api/clientes/lookup con cliente encontrado devuelve found:true", async () => {
    mockLookupCustomer.mockResolvedValue({
      found: true,
      datos: { nombres: "ALVARO", apellidos: "SEBASTIANI", telefono: "+51942568111", email: "cliente@example.com", direccion: {} },
    });

    const res = await request(createApp()).get("/api/clientes/lookup?tipoDocumento=DNI&numeroDocumento=15619884");

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(mockLookupCustomer).toHaveBeenCalledWith("DNI", "15619884", expect.anything());
  });

  it("GET /api/clientes/lookup sin cliente encontrado devuelve found:false", async () => {
    mockLookupCustomer.mockResolvedValue({ found: false });

    const res = await request(createApp()).get("/api/clientes/lookup?tipoDocumento=DNI&numeroDocumento=99999999");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ found: false });
  });

  it("GET /api/clientes/lookup con tipoDocumento invalido devuelve 400 sin llamar a C4C", async () => {
    const res = await request(createApp()).get("/api/clientes/lookup?tipoDocumento=PASAPORTE&numeroDocumento=123");

    expect(res.status).toBe(400);
    expect(mockLookupCustomer).not.toHaveBeenCalled();
  });

  it("GET /api/clientes/lookup responde 429 tras superar el limite de 10 solicitudes por minuto de la misma IP", async () => {
    mockLookupCustomer.mockResolvedValue({ found: false });
    const app = createApp();

    for (let i = 0; i < 10; i++) {
      const res = await request(app).get("/api/clientes/lookup?tipoDocumento=DNI&numeroDocumento=15619884");
      expect(res.status).toBe(200);
    }
    const res = await request(app).get("/api/clientes/lookup?tipoDocumento=DNI&numeroDocumento=15619884");
    expect(res.status).toBe(429);
  });
});
