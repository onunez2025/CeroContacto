import cors from "cors";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { handleSubmitServiceRequest } from "./handlers/submitServiceRequest.js";

export function createApp(): Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.post("/api/service-requests", async (req, res) => {
    const result = await handleSubmitServiceRequest(req.body, console);
    res.status(result.httpStatus).json(result.body);
  });

  // express.json() delega aqui los errores de parseo (body JSON malformado).
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof SyntaxError && "status" in err && (err as { status?: number }).status === 400) {
      res.status(400).json({ error: "Cuerpo JSON invalido" });
      return;
    }
    next(err);
  });

  return app;
}
