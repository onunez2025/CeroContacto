import sql from "mssql";
import type { ServiceRequestSubmission } from "@cerocontacto/shared";

export interface SubmissionOutcome {
  /** "Completed" | "Failed" (regla de negocio) | "Error" (excepcion no controlada, ej. C4C caido). */
  status: "Completed" | "Failed" | "Error";
  ticketIds?: string[];
  errorMessage?: string;
  /** Detalle tecnico (mensaje/stack crudo) - nunca se muestra al cliente, solo para diagnostico. */
  errorDetail?: string;
}

let poolPromise: Promise<sql.ConnectionPool> | undefined;

function getPool(): Promise<sql.ConnectionPool> {
  if (!poolPromise) {
    const server = process.env.SQL_SERVER;
    const database = process.env.SQL_DATABASE;
    const user = process.env.SQL_USER;
    const password = process.env.SQL_PASSWORD;

    if (!server || !database || !user || !password) {
      throw new Error("Faltan variables de entorno SQL_SERVER/SQL_DATABASE/SQL_USER/SQL_PASSWORD");
    }

    poolPromise = sql
      .connect({
        server,
        database,
        user,
        password,
        options: { encrypt: process.env.SQL_ENCRYPT !== "false", trustServerCertificate: false },
      })
      .catch((err) => {
        poolPromise = undefined;
        throw err;
      });
  }
  return poolPromise;
}

/**
 * Guarda cada envio del formulario (datos ingresados + resultado) en
 * CEROCONTACTO.FormSubmissions, para poder diagnosticar si una falla vino
 * de un dato mal ingresado por el cliente en vez de un problema de C4C.
 * Nunca debe interrumpir el flujo de creacion del ticket: el llamador
 * decide que hacer si esto falla (loguear y seguir).
 */
export async function recordSubmission(submission: ServiceRequestSubmission, outcome: SubmissionOutcome): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("payloadJson", sql.NVarChar(sql.MAX), JSON.stringify(submission))
    .input("tipoDocumento", sql.VarChar(10), submission.tipoDocumento)
    .input("numeroDocumento", sql.VarChar(20), submission.numeroDocumento)
    .input("status", sql.VarChar(20), outcome.status)
    .input("ticketIds", sql.NVarChar(200), outcome.ticketIds?.join(",") ?? null)
    .input("errorMessage", sql.NVarChar(1000), outcome.errorMessage ?? null)
    .input("errorDetail", sql.NVarChar(sql.MAX), outcome.errorDetail ?? null)
    .query(`
      INSERT INTO CEROCONTACTO.FormSubmissions
        (PayloadJson, TipoDocumento, NumeroDocumento, Status, TicketIds, ErrorMessage, ErrorDetail)
      VALUES
        (@payloadJson, @tipoDocumento, @numeroDocumento, @status, @ticketIds, @errorMessage, @errorDetail)
    `);
}
