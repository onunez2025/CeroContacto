import type { ServiceRequestSubmission } from "@cerocontacto/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearGraphTokenCacheForTests, sendTicketConfirmation } from "./mailer.js";

const submission: ServiceRequestSubmission = {
  tipoDocumento: "DNI",
  numeroDocumento: "15619884",
  nombres: "ALVARO",
  apellidos: "SEBASTIANI",
  telefono: "942568111",
  email: "cliente@example.com",
  direccion: {
    departamento: "15",
    provincia: "128",
    distrito: "1254",
    codigoPostal: "15064",
    direccion: "AV. EL SOL",
    numero: "555",
    referencia: "Frente al parque",
  },
  productos: [{ productId: "10054511" }],
  fechaVisita: "2026-08-14",
  medioContacto: "whatsapp",
  lugarCompra: "SODIMAC PERU S.A.",
  consentimiento: true,
  captchaToken: "token-123",
};

function fakeLog() {
  return { error: vi.fn() };
}

/** Respuesta de token valida por una hora. */
function tokenOk() {
  return new Response(JSON.stringify({ access_token: "TOKEN-ABC", expires_in: 3600 }), { status: 200 });
}

describe("sendTicketConfirmation", () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    clearGraphTokenCacheForTests();
    process.env.MS_GRAPH_TENANT_ID = "tenant";
    process.env.MS_GRAPH_CLIENT_ID = "client";
    process.env.MS_GRAPH_CLIENT_SECRET = "secret";
    process.env.MS_GRAPH_SENDER_EMAIL = "remitente@sole.com.pe";
  });

  afterEach(() => {
    process.env = { ...envBackup };
    vi.unstubAllGlobals();
  });

  it("envia al correo del FORMULARIO, no a ninguno de C4C", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    const ok = await sendTicketConfirmation({ submission, ticketIds: ["1401544"] }, fakeLog());

    expect(ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toContain("/users/remitente%40sole.com.pe/sendMail");
    const body = JSON.parse(init.body as string);
    expect(body.message.toRecipients).toEqual([{ emailAddress: { address: "cliente@example.com" } }]);
  });

  it("incluye el numero de ticket y la fecha legible en el cuerpo", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendTicketConfirmation({ submission, ticketIds: ["1401544"] }, fakeLog());

    const body = JSON.parse((fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string);
    expect(body.message.subject).toContain("1401544");
    expect(body.message.body.content).toContain("1401544");
    expect(body.message.body.content).toContain("14 de agosto de 2026");
  });

  it("NO lanza y devuelve false si Graph rechaza el envio", async () => {
    // El ticket ya existe en C4C cuando se llama a esta funcion: un fallo de
    // correo jamas debe convertirse en un error de la solicitud.
    const fetchMock = vi.fn().mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(new Response("no", { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    const log = fakeLog();

    const ok = await sendTicketConfirmation({ submission, ticketIds: ["1401544"] }, log);

    expect(ok).toBe(false);
    expect(log.error).toHaveBeenCalledWith("mailer_envio_fallido", expect.any(Error));
  });

  it("NO lanza y devuelve false si la red se cae al pedir el token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const log = fakeLog();

    const ok = await sendTicketConfirmation({ submission, ticketIds: ["1401544"] }, log);

    expect(ok).toBe(false);
    expect(log.error).toHaveBeenCalledWith("mailer_envio_fallido", expect.any(Error));
  });

  it("no intenta enviar si faltan las variables de entorno", async () => {
    delete process.env.MS_GRAPH_CLIENT_SECRET;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const log = fakeLog();

    const ok = await sendTicketConfirmation({ submission, ticketIds: ["1401544"] }, log);

    expect(ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith("mailer_sin_configurar", expect.any(Error));
  });

  it("reusa el token cacheado en el segundo envio", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendTicketConfirmation({ submission, ticketIds: ["1"] }, fakeLog());
    await sendTicketConfirmation({ submission, ticketIds: ["2"] }, fakeLog());

    // 1 token + 2 envios, no 2 tokens.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect((fetchMock.mock.calls[2] as [string])[0]).toContain("sendMail");
  });

  it("en resultado parcial avisa cuantos productos faltaron, sin mostrar codigos internos", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendTicketConfirmation(
      { submission, ticketIds: ["1401544"], productosFallidos: ["10054512", "10054513"] },
      fakeLog(),
    );

    const body = JSON.parse((fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string);
    expect(body.message.subject).toContain("parte de tu solicitud");
    expect(body.message.body.content).toContain("2 de tus productos");
    expect(body.message.body.content).not.toContain("10054512");
  });

  it("arma la direccion con distrito, provincia y departamento", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendTicketConfirmation({ submission, ticketIds: ["1401544"] }, fakeLog());

    const html = JSON.parse((fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string).message.body.content;
    // distrito 1254 = BARRANCO, provincia 128 = LIMA, departamento 15 = Lima
    expect(html).toContain("AV. EL SOL 555, BARRANCO, LIMA, Lima");
  });

  it("incluye el resumen del servicio y el boton de WhatsApp", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendTicketConfirmation({ submission, ticketIds: ["1401544"] }, fakeLog());

    const html = JSON.parse((fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string).message.body.content;
    expect(html).toContain("Resumen del servicio solicitado");
    expect(html).toContain("maximo en 24 horas");
    expect(html).toContain("SODIMAC PERU S.A.");
    expect(html).toContain("Frente al parque");
    expect(html).toContain("Instalacion");
    expect(html).toContain("api.whatsapp.com");
  });

  it("omite el banner si no hay PUBLIC_BASE_URL, sin romper el correo", async () => {
    delete process.env.PUBLIC_BASE_URL;
    const fetchMock = vi.fn().mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    const ok = await sendTicketConfirmation({ submission, ticketIds: ["1401544"] }, fakeLog());

    const html = JSON.parse((fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string).message.body.content;
    expect(ok).toBe(true);
    expect(html).not.toContain("<img");
    expect(html).toContain("Hola, ALVARO");
    // Sin banner, la web se muestra como texto (el banner ya la trae dentro).
    expect(html).toContain("www.gruposole.com.pe");
  });

  it("no duplica la web como texto cuando el banner ya la trae en la imagen", async () => {
    process.env.PUBLIC_BASE_URL = "https://ejemplo.test";
    const fetchMock = vi.fn().mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendTicketConfirmation({ submission, ticketIds: ["1401544"] }, fakeLog());

    const html = JSON.parse((fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string).message.body.content;
    expect(html).toContain("email-banner.png");
    expect(html).not.toContain("www.gruposole.com.pe");
  });

  it("incluye el banner cuando hay PUBLIC_BASE_URL, sin barra doble", async () => {
    process.env.PUBLIC_BASE_URL = "https://ejemplo.test/";
    const fetchMock = vi.fn().mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendTicketConfirmation({ submission, ticketIds: ["1401544"] }, fakeLog());

    const html = JSON.parse((fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string).message.body.content;
    expect(html).toContain('src="https://ejemplo.test/email-banner.png"');
  });

  it("escapa el HTML de los datos del cliente", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendTicketConfirmation(
      { submission: { ...submission, nombres: "<script>alert(1)</script>" }, ticketIds: ["1401544"] },
      fakeLog(),
    );

    const body = JSON.parse((fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string);
    expect(body.message.body.content).not.toContain("<script>");
    expect(body.message.body.content).toContain("&lt;script&gt;");
  });
});
