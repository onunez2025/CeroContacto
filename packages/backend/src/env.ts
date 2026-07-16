import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ENV_FILES: Record<string, string> = {
  local: ".env.local",
  qa: ".env.qa.local",
  production: ".env.production.local",
};

/**
 * Carga variables de entorno desde los archivos .env.*.local en la raiz del
 * monorepo, solo para desarrollo local fuera de Docker. En Dockploy las
 * variables las inyecta la plataforma directamente (no hay archivo .env en
 * la imagen) - dotenv simplemente no encuentra el archivo y no hace nada.
 */
export function loadLocalEnv(): void {
  const appEnv = process.env.APP_ENV ?? "local";
  const fileName = ENV_FILES[appEnv] ?? ".env.local";
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, "../../..");
  loadDotenv({ path: resolve(repoRoot, fileName) });
}
