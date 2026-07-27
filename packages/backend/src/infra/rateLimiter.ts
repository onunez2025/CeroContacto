import type { NextFunction, Request, Response } from "express";

interface RateLimiterOptions {
  windowMs: number;
  max: number;
}

/**
 * Rate limiter en memoria, por IP - sin dependencia nueva (no se agrega
 * express-rate-limit). Pensado para una sola instancia del proceso: si el
 * backend llegara a correr en mas de una instancia a la vez, el limite
 * efectivo se multiplica (ver docs/superpowers/specs/2026-07-24-
 * autocompletado-cliente-existente-design.md). No es un problema con el
 * despliegue actual en Dokploy (una sola instancia).
 */
export function createRateLimiter({ windowMs, max }: RateLimiterOptions) {
  const hits = new Map<string, number[]>();

  return function rateLimiter(req: Request, res: Response, next: NextFunction): void {
    const ip = req.ip ?? "unknown";
    const now = Date.now();
    const timestamps = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);

    if (timestamps.length >= max) {
      res.status(429).json({ error: "Demasiadas solicitudes. Intenta de nuevo en un momento." });
      return;
    }

    timestamps.push(now);
    hits.set(ip, timestamps);
    next();
  };
}
