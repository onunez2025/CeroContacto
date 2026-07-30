import { createApp } from "./app.js";
import { loadLocalEnv } from "./env.js";

loadLocalEnv();

const app = createApp();
const port = Number(process.env.PORT ?? 3000);

const server = app.listen(port, () => {
  console.log(`CeroContacto backend escuchando en :${port}`);
});

/**
 * El motor de cupos/creacion de tickets puede tardar varios minutos en
 * produccion para clientes con historial (ver C4CODataClient.timeoutMs,
 * que ya sube a 5 minutos). El requestTimeout por defecto de Node
 * (5 minutos tambien) coincidiria justo con ese limite - se desactiva
 * aqui para que el unico timeout real sea el explicito de C4CODataClient.
 */
server.requestTimeout = 0;
