import { createApp } from "./app.js";
import { loadLocalEnv } from "./env.js";

loadLocalEnv();

const app = createApp();
const port = Number(process.env.PORT ?? 3000);

app.listen(port, () => {
  console.log(`CeroContacto backend escuchando en :${port}`);
});
