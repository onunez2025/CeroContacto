import cors from "cors";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { buildProductCatalogClientFromEnv } from "./config.js";
import { PRODUCT_CATEGORIES, searchProducts } from "./domain/productCatalog/index.js";
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

  app.get("/api/productos/categorias", (_req, res) => {
    res.status(200).json({ categorias: PRODUCT_CATEGORIES });
  });

  app.get("/api/productos", async (req, res) => {
    const categoria = typeof req.query.categoria === "string" ? req.query.categoria : "";
    const q = typeof req.query.q === "string" ? req.query.q : "";

    if (!categoria || !q) {
      res.status(200).json({ productos: [] });
      return;
    }

    try {
      const client = buildProductCatalogClientFromEnv();
      const productos = await searchProducts(categoria, q, client);
      res.status(200).json({ productos });
    } catch (err) {
      console.error("productos_search_failed", err);
      res.status(502).json({ error: "No pudimos buscar productos en este momento." });
    }
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
