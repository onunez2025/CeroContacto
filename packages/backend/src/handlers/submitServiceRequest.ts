import { ServiceRequestSubmissionSchema } from "@cerocontacto/shared";
import { buildC4CClientFromEnv } from "../config.js";
import { recordSubmission } from "../infra/auditLog.js";
import { runServiceRequestOrchestration } from "../orchestrators/serviceRequestOrchestrator.js";

export interface RequestLog {
  error: (message: string, err: unknown) => void;
}

export interface HandlerResult {
  httpStatus: number;
  body: Record<string, unknown>;
}

/**
 * La bitacora en SQL Server es de diagnostico (ver que ingreso el cliente
 * cuando algo falla), nunca debe tumbar la respuesta al cliente si la
 * escritura falla (ej. SQL_* sin configurar en local, o el server caido).
 */
async function recordSubmissionSafely(
  submission: Parameters<typeof recordSubmission>[0],
  outcome: Parameters<typeof recordSubmission>[1],
  log: RequestLog,
): Promise<void> {
  try {
    await recordSubmission(submission, outcome);
  } catch (err) {
    log.error("submitServiceRequest_audit_log_failed", err);
  }
}

/**
 * POST /api/service-requests
 *
 * v1: sincrono - espera a que termine toda la orquestacion (varias
 * llamadas secuenciales a C4C, ~10-30s medido contra QA) y devuelve el
 * resultado final en la misma respuesta. Framework-agnostico: no depende
 * de Express ni de ningun runtime especifico, para poder montarlo detras
 * de cualquier servidor HTTP.
 */
export async function handleSubmitServiceRequest(body: unknown, log: RequestLog): Promise<HandlerResult> {
  const parsed = ServiceRequestSubmissionSchema.safeParse(body);
  if (!parsed.success) {
    return { httpStatus: 400, body: { error: "Datos invalidos", details: parsed.error.flatten() } };
  }

  let client;
  try {
    client = buildC4CClientFromEnv();
  } catch (err) {
    log.error("submitServiceRequest_config_error", err);
    return { httpStatus: 500, body: { error: "Configuracion de servidor incompleta" } };
  }

  try {
    const result = await runServiceRequestOrchestration(parsed.data, client);
    if (result.status === "Completed") {
      await recordSubmissionSafely(parsed.data, { status: "Completed", ticketIds: result.ticketIds }, log);
      return { httpStatus: 201, body: { status: "Completed", ticketIds: result.ticketIds } };
    }
    if (result.status === "Partial") {
      await recordSubmissionSafely(
        parsed.data,
        { status: "Partial", ticketIds: result.ticketIds, errorMessage: result.errorMessage },
        log,
      );
      return {
        httpStatus: 201,
        body: {
          status: "Partial",
          ticketIds: result.ticketIds,
          productosFallidos: result.productosFallidos,
          errorMessage: result.errorMessage,
        },
      };
    }
    await recordSubmissionSafely(parsed.data, { status: "Failed", errorMessage: result.errorMessage }, log);
    return { httpStatus: 200, body: { status: "Failed", errorMessage: result.errorMessage } };
  } catch (err) {
    log.error("submitServiceRequest_unhandled", err);
    await recordSubmissionSafely(
      parsed.data,
      { status: "Error", errorDetail: err instanceof Error ? (err.stack ?? err.message) : String(err) },
      log,
    );
    return {
      httpStatus: 502,
      body: { error: "No pudimos comunicarnos con SAP C4C. Intenta de nuevo en unos minutos." },
    };
  }
}
