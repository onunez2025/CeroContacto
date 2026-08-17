import { createApp } from "./app.js";
import { loadLocalEnv } from "./env.js";

loadLocalEnv();

/**
 * Aviso al arranque de las integraciones OPCIONALES que quedaron sin
 * configurar. Sin esto, una variable que no llega al contenedor solo se
 * nota cuando alguien reclama: el correo de confirmacion estuvo caido en
 * produccion del 2026-08-11 al 2026-08-17 porque docker-compose.yml no
 * declaraba las MS_GRAPH_*, y readGraphConfig() simplemente devolvia
 * undefined y seguia de largo. Las variables OBLIGATORIAS (C4C_*, SQL_*)
 * no van aca: esas ya revientan al usarse.
 */
function avisarIntegracionesSinConfigurar(): void {
  const faltantes = [
    "MS_GRAPH_TENANT_ID",
    "MS_GRAPH_CLIENT_ID",
    "MS_GRAPH_CLIENT_SECRET",
    "MS_GRAPH_SENDER_EMAIL",
  ].filter((name) => !process.env[name]);

  if (faltantes.length > 0) {
    console.warn(
      `ATENCION: no se enviaran correos de confirmacion - faltan variables de entorno: ${faltantes.join(", ")}`,
    );
  } else {
    console.log(`Correo de confirmacion habilitado (remitente: ${process.env.MS_GRAPH_SENDER_EMAIL})`);
  }

  if (!process.env.PUBLIC_BASE_URL) {
    console.warn("AVISO: falta PUBLIC_BASE_URL - el correo se enviara sin el banner de cabecera.");
  }
}

const app = createApp();
const port = Number(process.env.PORT ?? 3000);

const server = app.listen(port, () => {
  console.log(`CeroContacto backend escuchando en :${port}`);
  avisarIntegracionesSinConfigurar();
});

/**
 * El motor de cupos/creacion de tickets puede tardar varios minutos en
 * produccion para clientes con historial (ver C4CODataClient.timeoutMs,
 * que ya sube a 5 minutos). El requestTimeout por defecto de Node
 * (5 minutos tambien) coincidiria justo con ese limite - se desactiva
 * aqui para que el unico timeout real sea el explicito de C4CODataClient.
 */
server.requestTimeout = 0;
