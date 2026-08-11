import type { ServiceRequestSubmission } from "@cerocontacto/shared";
import { PERU_DEPARTAMENTOS, PERU_DISTRITOS, PERU_PROVINCIAS } from "@cerocontacto/shared";

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

/**
 * "AV. EL SOL 555, CHORRILLOS, LIMA, LIMA" - calle+numero, distrito,
 * provincia y departamento, en el mismo orden que la plataforma actual.
 * Cada nivel se omite si su codigo no resuelve a un nombre conocido, en vez
 * de imprimir el codigo crudo (que no significa nada para el cliente).
 */
function buildDireccionTexto(submission: ServiceRequestSubmission): string {
  const { direccion } = submission;
  const distrito = PERU_DISTRITOS.find((d) => d.id === direccion.distrito)?.nombre;
  const provincia = PERU_PROVINCIAS.find((p) => p.id === direccion.provincia)?.nombre;
  const departamento = PERU_DEPARTAMENTOS.find((d) => d.code === direccion.departamento)?.label;
  const calle = [direccion.direccion, direccion.numero].map((s) => s.trim()).filter(Boolean).join(" ");
  return [calle, distrito, provincia, departamento].filter(Boolean).join(", ");
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

const WHATSAPP_TEL = "(01) 6190500";
const WHATSAPP_URL = "https://api.whatsapp.com/send/?phone=5116190500&text&type=phone_number&app_absent=0";
const SITIO_WEB = "www.gruposole.com.pe";
const AZUL = "#3d4f6b";
const ROJO = "#c1121f";

/** Una fila de dos columnas del recuadro de resumen. */
function filaResumen(izq: [string, string], der?: [string, string]): string {
  const celda = ([etiqueta, valor]: [string, string]) =>
    `<td style="padding:10px 14px;vertical-align:top;width:50%;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a1a">
       <strong style="display:block;color:${AZUL}">${escapeHtml(etiqueta)}</strong>${escapeHtml(valor)}
     </td>`;
  return `<tr>${celda(izq)}${der ? celda(der) : '<td style="width:50%"></td>'}</tr>`;
}

/**
 * Cuerpo del correo en el formato de la plataforma actual: barra con logo,
 * banner, saludo, aviso de contacto por WhatsApp y recuadro de resumen.
 *
 * Se arma con tablas y estilos en linea a proposito: los clientes de correo
 * (Outlook sobre todo) no soportan flex/grid ni hojas de estilo externas.
 */
function buildHtml(input: TicketConfirmationInput): string {
  const { submission, ticketIds, productosFallidos } = input;
  const saludo = escapeHtml(nombreDelCliente(submission));
  const fecha = formatFecha(submission.fechaVisita);
  const direccion = buildDireccionTexto(submission);

  const bannerUrl = process.env.PUBLIC_BASE_URL
    ? `${process.env.PUBLIC_BASE_URL.replace(/\/$/, "")}/email-banner.png`
    : undefined;
  // El banner ya trae el logo y la direccion web dentro de la imagen, asi que
  // la fila de texto con la web solo se dibuja cuando NO hay banner (sin
  // PUBLIC_BASE_URL, o si el cliente de correo bloquea imagenes remotas).
  const banner = bannerUrl
    ? `<tr><td style="padding:0"><img src="${escapeHtml(bannerUrl)}" width="600" alt="Grupo Sole - Asegura la vida util de tus equipos"
         style="display:block;width:100%;max-width:600px;height:auto;border:0"></td></tr>`
    : `<tr><td style="padding:18px 24px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${AZUL}" align="right">
         Web: ${escapeHtml(SITIO_WEB)}
       </td></tr>`;

  const ticketsFila =
    ticketIds.length === 1
      ? filaResumen(["Numero de ticket:", ticketIds[0] as string])
      : filaResumen(["Numeros de ticket:", ticketIds.join(", ")]);

  // En un resultado parcial el correo solo conoce el productId, un codigo
  // interno sin significado para el cliente: se le dice cuantos equipos
  // faltaron y que un asesor los vera, sin mostrar codigos.
  const faltantes = productosFallidos?.length
    ? `<tr><td style="padding:0 14px 14px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${ROJO}">
         No pudimos agendar ${productosFallidos.length === 1 ? "uno de tus equipos" : `${productosFallidos.length} de tus equipos`}.
         Un asesor se comunicara contigo para completarlo.
       </td></tr>`
    : "";

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f4f5f7;padding:16px 0">
<tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background:#ffffff">

  ${banner}

  <tr><td align="center" style="padding:26px 24px 6px;font-family:Arial,Helvetica,sans-serif;font-size:24px;font-weight:bold;color:#1a1a1a">
    Hola, ${saludo}
  </td></tr>

  <tr><td align="center" style="padding:0 32px 20px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a">
    Estamos procesando su solicitud, y maximo en 24 horas le llegara un
    <strong>WhatsApp (01-6190500)</strong> confirmando la fecha de atencion.
  </td></tr>

  <tr><td align="center" style="padding:0 24px 12px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:${ROJO}">
    Resumen del servicio solicitado
  </td></tr>

  <tr><td style="padding:0 24px 20px">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid #dcdfe4;border-radius:6px">
      ${filaResumen(["Direccion:", direccion], ["Referencia:", submission.direccion.referencia])}
      ${filaResumen(["Tipo de servicio:", "Instalacion"], ["Tienda donde compro:", submission.lugarCompra])}
      ${filaResumen(["Fecha deseada:", fecha])}
      ${ticketsFila}
      ${faltantes}
    </table>
  </td></tr>

  <tr><td align="center" style="padding:0 24px 12px;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1a1a1a">
    Para solicitar mayor informacion contactarse al WhatsApp.
  </td></tr>

  <tr><td align="center" style="padding:0 24px 30px">
    <a href="${WHATSAPP_URL}" style="display:inline-block;background:${AZUL};color:#ffffff;text-decoration:none;
       font-family:Arial,Helvetica,sans-serif;font-size:17px;font-weight:bold;padding:13px 34px;border-radius:26px">
      ${escapeHtml(WHATSAPP_TEL)}
    </a>
  </td></tr>

</table>
</td></tr>
</table>`;
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
