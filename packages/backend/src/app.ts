import cors from "cors";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { buildC4CClientFromEnv, buildProductCatalogClientFromEnv } from "./config.js";
import { lookupCustomer, CustomerLookupQuerySchema } from "./domain/customerLookup/index.js";
import { getFechasDisponibles } from "./domain/cuposEngine/index.js";
import { hasActiveCoverage, isValidPostalCode, searchPostalCodes } from "./domain/postalCodeLookup/index.js";
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

  /**
   * Estado del servicio + integraciones OPCIONALES que fallan en silencio.
   *
   * El correo de confirmacion estuvo caido en produccion del 2026-08-11 al
   * 2026-08-17 sin que nadie lo notara: docker-compose.yml no le pasaba las
   * MS_GRAPH_* al contenedor, y el mailer esta hecho a proposito para no
   * tumbar la creacion del ticket cuando no puede enviar. Diagnosticarlo
   * exigio revisar los logs del contenedor correcto; con esto se resuelve
   * con un GET.
   *
   * Solo expone BOOLEANOS y el remitente (que va en el From de cada correo
   * que se manda, no es un secreto). Nunca el tenant, el clientId ni el
   * secret.
   */
  app.get("/health", (_req, res) => {
    const remitente = process.env.MS_GRAPH_SENDER_EMAIL;
    const correoConfigurado = Boolean(
      process.env.MS_GRAPH_TENANT_ID &&
        process.env.MS_GRAPH_CLIENT_ID &&
        process.env.MS_GRAPH_CLIENT_SECRET &&
        remitente,
    );
    res.status(200).json({
      status: "ok",
      correo: {
        configurado: correoConfigurado,
        remitente: correoConfigurado ? remitente : null,
        bannerConfigurado: Boolean(process.env.PUBLIC_BASE_URL),
      },
    });
  });

  /**
   * 20/hora por IP. Es la ruta mas cara y la unica que ESCRIBE en C4C: cada
   * envio crea cliente, producto registrado y ticket reales, y tarda ~20s.
   * Hasta ahora no tenia ningun limite, y el captchaToken que exige el DTO
   * es un placeholder que nadie verifica contra un proveedor (ver
   * captchaToken en shared/serviceRequestDto.ts), asi que en la practica el
   * endpoint estaba completamente abierto - confirmado en vivo el
   * 2026-08-10 creando tickets reales con peticiones directas, sin navegador.
   *
   * La ventana es de una hora y el limite generoso a proposito: un cliente
   * legitimo envia 1-3 veces, pero las operadoras moviles de Peru usan CGNAT
   * y una tienda podria registrar a varios clientes desde la misma IP. 20/h
   * no estorba a ninguno de esos casos y aun asi corta en seco el abuso
   * trivial (un script en paralelo pasa de ilimitado a 20). No sustituye al
   * CAPTCHA real, que sigue pendiente.
   */
  const submitRateLimiter = createRateLimiter({ windowMs: 60 * 60_000, max: 20 });

  app.post("/api/service-requests", submitRateLimiter, async (req, res) => {
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

  // 60/min: mismo patron que /api/codigos-postales* - esta ruta nunca tuvo
  // rate limiter porque el motor de cupos estaba deshabilitado y nunca se
  // ejecutaba de verdad (confirmado 2026-07-30, ver docs/superpowers/specs/
  // 2026-07-30-fechas-disponibles-reactivacion-design.md).
  const fechasDisponiblesRateLimiter = createRateLimiter({ windowMs: 60_000, max: 60 });

  app.get("/api/fechas-disponibles", fechasDisponiblesRateLimiter, async (req, res) => {
    const departamento = typeof req.query.departamento === "string" ? req.query.departamento : "";
    const codigoPostal = typeof req.query.codigoPostal === "string" ? req.query.codigoPostal : "";

    // Formato valido ademas de no-vacio: acota el espacio de claves del
    // cache en memoria de getFechasDisponibles (Map sin limite, indexado
    // por estos dos valores) y evita mandar codigos postales/departamentos
    // arbitrarios a producción de C4C (confirmado en revision final,
    // 2026-07-30). Mismo patron de codigoPostal que ServiceRequestDto en
    // shared (4 a 6 digitos); departamento es 1-2 digitos como en
    // PERU_DEPARTAMENTOS ("01".."25").
    if (!/^\d{1,2}$/.test(departamento) || !/^\d{4,6}$/.test(codigoPostal)) {
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

  // 60/min: mas generoso que el limite de /api/clientes/lookup (10/min) porque
  // esta data no es PII, y estas rutas comparten un cache en memoria de 10
  // minutos por departamento, por lo que casi nunca disparan una consulta
  // real contra C4C produccion mas alla del primer request por departamento
  // en esa ventana.
  const postalCodesRateLimiter = createRateLimiter({ windowMs: 60_000, max: 60 });

  app.get("/api/codigos-postales", postalCodesRateLimiter, async (req, res) => {
    const departamento = typeof req.query.departamento === "string" ? req.query.departamento : "";
    const q = typeof req.query.q === "string" ? req.query.q : "";

    if (!departamento || !q) {
      res.status(200).json({ resultados: [], hayMasResultados: false });
      return;
    }

    try {
      const client = buildProductCatalogClientFromEnv();
      const result = await searchPostalCodes(departamento, q, client);
      res.status(200).json(result);
    } catch (err) {
      console.error("codigos_postales_search_failed", err);
      res.status(502).json({ error: "No pudimos buscar codigos postales en este momento." });
    }
  });

  app.get("/api/codigos-postales/cobertura", postalCodesRateLimiter, async (req, res) => {
    const departamento = typeof req.query.departamento === "string" ? req.query.departamento : "";

    if (!departamento) {
      res.status(200).json({ tieneCobertura: false });
      return;
    }

    try {
      const client = buildProductCatalogClientFromEnv();
      const tieneCobertura = await hasActiveCoverage(departamento, client);
      res.status(200).json({ tieneCobertura });
    } catch (err) {
      console.error("codigos_postales_cobertura_failed", err);
      res.status(502).json({ error: "No pudimos verificar la cobertura en este momento." });
    }
  });

  app.get("/api/codigos-postales/validar", postalCodesRateLimiter, async (req, res) => {
    const departamento = typeof req.query.departamento === "string" ? req.query.departamento : "";
    const codigoPostal = typeof req.query.codigoPostal === "string" ? req.query.codigoPostal : "";

    if (!departamento || !codigoPostal) {
      res.status(200).json({ valido: false });
      return;
    }

    try {
      const client = buildProductCatalogClientFromEnv();
      const valido = await isValidPostalCode(departamento, codigoPostal, client);
      res.status(200).json({ valido });
    } catch (err) {
      console.error("codigos_postales_validar_failed", err);
      res.status(502).json({ error: "No pudimos validar el codigo postal en este momento." });
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
