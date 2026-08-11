import type { ServiceRequestSubmission } from "@cerocontacto/shared";
import { PERU_DISTRITOS } from "@cerocontacto/shared";

/**
 * Envio del correo de confirmacion al cliente via Microsoft Graph
 * (aplicacion "SMTP APP RECLAMACIONES SOLE", permiso Mail.Send con
 * credenciales de aplicacion - no hay usuario interactivo).
 *
 * Regla de oro de este modulo: NUNCA puede tumbar la creacion del ticket.
 * Cuando se llama, el ticket ya existe en C4C y el cliente ya vio su numero
 * en pantalla; que el correo falle es una degradacion, no un error. Mismo
 * criterio que el PATCH de estado inicial y que la bitacora en SQL.
 */

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const LOGIN_BASE = "https://login.microsoftonline.com";

/** Margen antes de la expiracion real para no usar un token recien vencido. */
const TOKEN_EXPIRY_MARGIN_MS = 5 * 60_000;

interface GraphConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  senderEmail: string;
}

/**
 * Lee la configuracion de Graph del entorno. Devuelve undefined si falta
 * cualquier variable: sin credenciales simplemente no se envia correo, en
 * vez de reventar el arranque o la creacion del ticket. Asi el formulario
 * sigue funcionando completo en desarrollo local sin configurar Graph.
 */
function readGraphConfig(): GraphConfig | undefined {
  const tenantId = process.env.MS_GRAPH_TENANT_ID;
  const clientId = process.env.MS_GRAPH_CLIENT_ID;
  const clientSecret = process.env.MS_GRAPH_CLIENT_SECRET;
  const senderEmail = process.env.MS_GRAPH_SENDER_EMAIL;
  if (!tenantId || !clientId || !clientSecret || !senderEmail) return undefined;
  return { tenantId, clientId, clientSecret, senderEmail };
}

let cachedToken: { value: string; expiresAt: number } | undefined;

/** Solo para tests: olvida el token cacheado entre casos. */
export function clearGraphTokenCacheForTests(): void {
  cachedToken = undefined;
}

/**
 * Token de aplicacion (client credentials). Se cachea en memoria porque
 * dura ~65 min y pedir uno por cada correo seria un viaje de red inutil en
 * el camino critico del envio del formulario.
 */
async function getAccessToken(config: GraphConfig): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now) return cachedToken.value;

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const res = await fetch(`${LOGIN_BASE}/${config.tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    throw new Error(`Graph token fallo con HTTP ${res.status}`);
  }

  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("Graph token sin access_token");

  const expiresInMs = (json.expires_in ?? 3600) * 1000;
  cachedToken = { value: json.access_token, expiresAt: now + expiresInMs - TOKEN_EXPIRY_MARGIN_MS };
  return json.access_token;
}

/** Escapa el texto que se interpola en el HTML del correo. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** "2026-08-14" -> "14 de agosto de 2026". */
const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
function formatFecha(iso: string): string {
  const [year, month, day] = iso.split("-");
  const mes = MESES[Number(month) - 1];
  if (!year || !day || !mes) return iso;
  return `${Number(day)} de ${mes} de ${year}`;
}

function buildDireccionTexto(submission: ServiceRequestSubmission): string {
  const { direccion } = submission;
  const distrito = PERU_DISTRITOS.find((d) => d.id === direccion.distrito)?.nombre;
  const partes = [`${direccion.direccion} ${direccion.numero}`.trim(), distrito].filter(Boolean);
  return partes.join(", ");
}

function nombreDelCliente(submission: ServiceRequestSubmission): string {
  return submission.tipoDocumento === "RUC" ? submission.razonSocial : submission.nombres;
}

export interface TicketConfirmationInput {
  submission: ServiceRequestSubmission;
  /** Tickets creados, en el orden de los productos de la solicitud. */
  ticketIds: string[];
  /** productId de los equipos que no lograron ticket (resultado parcial). */
  productosFallidos?: string[];
}

function buildSubject(input: TicketConfirmationInput): string {
  if (input.productosFallidos?.length) {
    return "Registramos parte de tu solicitud de instalacion";
  }
  return input.ticketIds.length === 1
    ? `Tu solicitud de instalacion fue registrada - Ticket ${input.ticketIds[0]}`
    : "Tu solicitud de instalacion fue registrada";
}

function buildHtml(input: TicketConfirmationInput): string {
  const { submission, ticketIds, productosFallidos } = input;
  const saludo = escapeHtml(nombreDelCliente(submission));
  const fecha = escapeHtml(formatFecha(submission.fechaVisita));
  const direccion = escapeHtml(buildDireccionTexto(submission));

  const tickets =
    ticketIds.length === 1
      ? `<p>Tu numero de ticket es <strong>${escapeHtml(ticketIds[0] as string)}</strong>.</p>`
      : `<p>Se genero un ticket por cada equipo:</p><ul>${ticketIds
          .map((id) => `<li><strong>${escapeHtml(id)}</strong></li>`)
          .join("")}</ul>`;

  // En un resultado parcial no se listan modelos: el correo solo conoce el
  // productId (un codigo interno que no significa nada para el cliente), asi
  // que se le indica cuantos equipos faltaron y que un asesor los vera.
  const faltantes = productosFallidos?.length
    ? `<p>No pudimos agendar ${productosFallidos.length === 1 ? "uno de tus equipos" : `${productosFallidos.length} de tus equipos`}.
       Un asesor se comunicara contigo para completar el registro.</p>`
    : "";

  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a">
  <p>Hola ${saludo},</p>
  <p>Registramos tu solicitud de instalacion.</p>
  ${tickets}
  ${faltantes}
  <p>
    <strong>Fecha solicitada:</strong> ${fecha}<br>
    <strong>Direccion:</strong> ${direccion}
  </p>
  <p>Un asesor te contactara por WhatsApp o correo en las proximas horas para confirmar la fecha
  y el tecnico asignado. La fecha que elegiste es tentativa hasta esa confirmacion.</p>
  <p>Si necesitas ayuda, escribenos al (01) 6190500.</p>
  <p style="color:#666;font-size:13px">Grupo Sole - Rinnai Corporation</p>
</div>`;
}

/**
 * Envia la confirmacion al correo que el cliente escribio EN EL FORMULARIO,
 * nunca al que figura en C4C: confirmado el 2026-08-11 que las fichas reales
 * pueden traer una direccion corporativa (contactcenter@sole.com.pe), con lo
 * que el aviso terminaria en SOLE en vez de en el cliente.
 *
 * No lanza nunca. Devuelve true si Graph acepto el envio.
 */
export async function sendTicketConfirmation(
  input: TicketConfirmationInput,
  log: { error: (message: string, err: unknown) => void },
): Promise<boolean> {
  const config = readGraphConfig();
  if (!config) {
    log.error("mailer_sin_configurar", new Error("Faltan variables MS_GRAPH_*; no se envio el correo"));
    return false;
  }

  try {
    const token = await getAccessToken(config);
    const res = await fetch(`${GRAPH_BASE}/users/${encodeURIComponent(config.senderEmail)}/sendMail`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          subject: buildSubject(input),
          body: { contentType: "HTML", content: buildHtml(input) },
          toRecipients: [{ emailAddress: { address: input.submission.email } }],
        },
        saveToSentItems: true,
      }),
    });

    if (!res.ok) {
      throw new Error(`Graph sendMail fallo con HTTP ${res.status}`);
    }
    return true;
  } catch (err) {
    log.error("mailer_envio_fallido", err);
    return false;
  }
}
