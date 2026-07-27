import cors from "cors";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { buildC4CClientFromEnv, buildProductCatalogClientFromEnv } from "./config.js";
import { lookupCustomer, CustomerLookupQuerySchema } from "./domain/customerLookup/index.js";
import { getFechasDisponibles } from "./domain/cuposEngine/index.js";
import { PRODUCT_CATEGORIES, searchProducts } from "./domain/productCatalog/index.js";
import { handleSubmitServiceRequest } from "./handlers/submitServiceRequest.js";
import { createRateLimiter } from "./infra/rateLimiter.js";

export function createApp(): Express {
  const app = express();
  app.use(cors());
  // Confiar en los 2 saltos de infraestructura frente al proceso Node (Traefik y
  // nginx, ver nginx/frontend.conf), que reenvian el X-Forwarded-For real del
  // cliente. Sin esto, Express ignora X-Forwarded-For y req.ip resuelve siempre
  // a la direccion interna de Docker, haciendo que el rate limiter por IP
  // (rateLimiter.ts) se comparta entre TODOS los visitantes. Usamos un numero
  // fijo de saltos (no `true`) para no confiar en un X-Forwarded-For arbitrario
  // que el propio cliente podria falsificar para saltarse el limite.
  app.set("trust proxy", 2);
  // 30mb: hasta 4 productos x 6 fotos redimensionadas (~800kb c/u como base64) en un solo POST.
  app.use(express.json({ limit: "30mb" }));

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

  app.get("/api/fechas-disponibles", async (req, res) => {
    const departamento = typeof req.query.departamento === "string" ? req.query.departamento : "";
    const codigoPostal = typeof req.query.codigoPostal === "string" ? req.query.codigoPostal : "";
    const productos =
      typeof req.query.productos === "string" ? req.query.productos.split(",").filter(Boolean) : [];

    if (!departamento || !codigoPostal || productos.length === 0) {
      res.status(200).json({ fechas: [] });
      return;
    }

    const desde = new Date();
    desde.setUTCDate(desde.getUTCDate() + 1);
    const hasta = new Date(desde);
    hasta.setUTCDate(hasta.getUTCDate() + 41);

    try {
      const client = buildC4CClientFromEnv();
      const fechas = await getFechasDisponibles(
        {
          productIds: productos,
          postalCode: codigoPostal,
          regionCode: departamento,
          desde: desde.toISOString().slice(0, 10),
          hasta: hasta.toISOString().slice(0, 10),
        },
        client,
      );
      res.status(200).json({ fechas });
    } catch (err) {
      console.error("fechas_disponibles_failed", err);
      res.status(502).json({ error: "No pudimos consultar la disponibilidad en este momento." });
    }
  });

  const customerLookupRateLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });

  app.get("/api/clientes/lookup", customerLookupRateLimiter, async (req, res) => {
    const parsed = CustomerLookupQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Parametros invalidos" });
      return;
    }

    try {
      const client = buildC4CClientFromEnv();
      const result = await lookupCustomer(parsed.data.tipoDocumento, parsed.data.numeroDocumento, client);
      res.status(200).json(result);
    } catch (err) {
      console.error("customer_lookup_failed", err);
      res.status(502).json({ error: "No pudimos consultar tus datos en este momento." });
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
