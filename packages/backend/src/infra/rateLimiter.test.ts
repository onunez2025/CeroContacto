import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { createRateLimiter } from "./rateLimiter.js";

function fakeReq(ip: string): Request {
  return { ip } as Request;
}

function fakeRes(): Response {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("createRateLimiter", () => {
  it("permite las primeras `max` solicitudes de una misma IP", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 3 });
    for (let i = 0; i < 3; i++) {
      const next = vi.fn();
      limiter(fakeReq("1.1.1.1"), fakeRes(), next);
      expect(next).toHaveBeenCalledTimes(1);
    }
  });

  it("bloquea la solicitud que excede el maximo con 429", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 3 });
    for (let i = 0; i < 3; i++) {
      limiter(fakeReq("2.2.2.2"), fakeRes(), vi.fn());
    }
    const res = fakeRes();
    const next = vi.fn();
    limiter(fakeReq("2.2.2.2"), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith({ error: "Demasiadas solicitudes. Intenta de nuevo en un momento." });
  });

  it("cuenta cada IP por separado", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1 });
    limiter(fakeReq("3.3.3.3"), fakeRes(), vi.fn());
    const nextOtherIp = vi.fn();
    limiter(fakeReq("4.4.4.4"), fakeRes(), nextOtherIp);
    expect(nextOtherIp).toHaveBeenCalledTimes(1);
  });

  it("vuelve a permitir despues de que expira la ventana", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1 });
    limiter(fakeReq("5.5.5.5"), fakeRes(), vi.fn());

    nowSpy.mockReturnValue(1_000_000 + 60_001);
    const next = vi.fn();
    limiter(fakeReq("5.5.5.5"), fakeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);

    nowSpy.mockRestore();
  });
});
