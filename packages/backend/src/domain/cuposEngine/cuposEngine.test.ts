import type { IC4CODataClient } from "@cerocontacto/c4c-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assignCupo, clearFechasDisponiblesCacheForTests, getFechasDisponibles } from "./index.js";
import { dayOfWeekIndex } from "./steps.js";
import type { CuposEngineInput, FechasDisponiblesInput } from "./types.js";

beforeEach(() => {
  // El cache de fechas disponibles es un Map a nivel de modulo - sin
  // limpiarlo entre tests, dos tests que usan la misma combinacion de
  // departamento/codigoPostal/rango se contaminarian entre si.
  clearFechasDisponiblesCacheForTests();
});

const baseInput: CuposEngineInput = {
  productIds: ["10054511"],
  postalCode: "07021",
  regionCode: "15",
  fechaVisita: "2026-07-20", // lunes (confirmado con getUTCDay())
};

const region = { zRegRegin: "SOLE-ADICIONALES-LIMA", zRegcode: "LIMA_SOLE-ADICIONALES-LIMA_15063", zRegid: "776679E1" };

const candidateA = { ObjectID: "OBJ-A", zCupIdEmpresa: "1306EXT-3", zCupPrioridadNEw: 3, zCupDepart: "15", zCupactivo: true };
const candidateB = { ObjectID: "OBJ-B", zCupIdEmpresa: "1305EXT", zCupPrioridadNEw: 1, zCupDepart: "15", zCupactivo: true };

/** El cliente real es generico (`getCollection<T>`); en los mocks devolvemos
 * shapes concretas por ruta, asi que se castea una sola vez aqui. */
function clientFromRouter(router: (path: string) => Promise<unknown[]>): IC4CODataClient {
  return {
    getCollection: vi.fn(router) as unknown as IC4CODataClient["getCollection"],
    postEntity: vi.fn(),
    patch: vi.fn(),
  };
}

function routedClient(routes: Record<string, unknown[]>): IC4CODataClient {
  return clientFromRouter(async (path) => {
    for (const [key, value] of Object.entries(routes)) {
      if (path.includes(key)) return value;
    }
    return [];
  });
}

describe("dayOfWeekIndex", () => {
  it("calcula el dia de semana en UTC (0=Domingo), usando fechas ancla conocidas", () => {
    expect(dayOfWeekIndex("2024-01-01")).toBe(1); // lunes (fecha ancla conocida)
    expect(dayOfWeekIndex("2024-01-07")).toBe(0); // domingo
  });
});

describe("assignCupo", () => {
  it("falla con NO_PRODUCT_GROUP si no se resuelve el grupo de material", async () => {
    const client = routedClient({ MaterialSalesProcessInformationCollection: [] });
    const result = await assignCupo(baseInput, client);
    expect(result).toEqual({ ok: false, reason: "NO_PRODUCT_GROUP", detail: expect.any(String) });
  });

  it("falla con NO_REGION_MATCH si el codigo postal no matchea ninguna region activa", async () => {
    const client = routedClient({
      MaterialSalesProcessInformationCollection: [{ ProductGroup2: "M74" }],
      BO_RegionRootCollection: [],
    });
    const result = await assignCupo(baseInput, client);
    expect(result).toEqual({ ok: false, reason: "NO_REGION_MATCH", detail: expect.any(String) });
  });

  it("falla con NO_CANDIDATE_COMPANY si no hay empresas activas en el departamento", async () => {
    const client = routedClient({
      MaterialSalesProcessInformationCollection: [{ ProductGroup2: "M74" }],
      BO_RegionRootCollection: [region],
      BO_CuposEmpresaRootCollection: [],
    });
    const result = await assignCupo(baseInput, client);
    expect(result).toEqual({ ok: false, reason: "NO_CANDIDATE_COMPANY", detail: expect.any(String) });
  });

  it("hace fallback a la siguiente candidata si la primera no pasa los chequeos de habilitacion", async () => {
    const client = clientFromRouter(async (path) => {
      if (path.includes("MaterialSalesProcessInformationCollection")) return [{ ProductGroup2: "M74" }];
      if (path.includes("BO_RegionRootCollection")) return [region];
      if (path.includes("BO_CuposEmpresaRootCollection") && !path.includes("(")) return [candidateA, candidateB];
      // Candidata A (mayor prioridad) no tiene el tipo de servicio habilitado.
      if (path.includes("OBJ-A") && path.includes("CuposTipoServicio")) return [];
      if (path.includes("OBJ-A") && path.includes("CuposGrupoMaterial")) return [{ zCupIdGrupoMaterial: "M74" }];
      if (path.includes("OBJ-A") && path.includes("CuposEmpresaFecha")) return [{ zCupFechLunes: true }];
      // Candidata B pasa todo.
      if (path.includes("OBJ-B") && path.includes("CuposTipoServicio")) return [{ zIDTipoServicio: "CA_1" }];
      if (path.includes("OBJ-B") && path.includes("CuposGrupoMaterial")) return [{ zCupIdGrupoMaterial: "M74" }];
      if (path.includes("OBJ-B") && path.includes("CuposEmpresaFecha")) return [{ zCupFechLunes: true }];
      if (path.includes("BO_CupoPorAreaRootCollection")) return [{ zCantidadDisponible: 3, zIdRegistro: "REG-B" }];
      return [];
    });

    const result = await assignCupo(baseInput, client);

    expect(result).toEqual({
      ok: true,
      companyId: "1305EXT",
      reservationId: "REG-B",
      cabRegion: region.zRegRegin,
      regionFsm: region.zRegcode,
      regionFsmId: region.zRegid,
    });
  });

  it("falla con NO_CAPACITY si ninguna candidata tiene cupo disponible para la fecha", async () => {
    const client = clientFromRouter(async (path) => {
      if (path.includes("MaterialSalesProcessInformationCollection")) return [{ ProductGroup2: "M74" }];
      if (path.includes("BO_RegionRootCollection")) return [region];
      if (path.includes("BO_CuposEmpresaRootCollection") && !path.includes("(")) return [candidateA];
      if (path.includes("CuposTipoServicio")) return [{ zIDTipoServicio: "CA_1" }];
      if (path.includes("CuposGrupoMaterial")) return [{ zCupIdGrupoMaterial: "M74" }];
      if (path.includes("CuposEmpresaFecha")) return [{ zCupFechLunes: true }];
      if (path.includes("BO_CupoPorAreaRootCollection")) return [{ zCantidadDisponible: 0, zIdRegistro: "REG-A" }];
      return [];
    });

    const result = await assignCupo(baseInput, client);
    expect(result).toEqual({ ok: false, reason: "NO_CAPACITY", detail: expect.any(String) });
  });

  it("asigna la unica candidata cuando pasa todos los chequeos y tiene capacidad", async () => {
    const client = clientFromRouter(async (path) => {
      if (path.includes("MaterialSalesProcessInformationCollection")) return [{ ProductGroup2: "M74" }];
      if (path.includes("BO_RegionRootCollection")) return [region];
      if (path.includes("BO_CuposEmpresaRootCollection") && !path.includes("(")) return [candidateA];
      if (path.includes("CuposTipoServicio")) return [{ zIDTipoServicio: "CA_1" }];
      if (path.includes("CuposGrupoMaterial")) return [{ zCupIdGrupoMaterial: "M74" }];
      if (path.includes("CuposEmpresaFecha")) return [{ zCupFechLunes: true }];
      if (path.includes("BO_CupoPorAreaRootCollection")) return [{ zCantidadDisponible: 5, zIdRegistro: "REG-A" }];
      return [];
    });

    const result = await assignCupo(baseInput, client);
    expect(result).toEqual({
      ok: true,
      companyId: candidateA.zCupIdEmpresa,
      reservationId: "REG-A",
      cabRegion: region.zRegRegin,
      regionFsm: region.zRegcode,
      regionFsmId: region.zRegid,
    });
  });

  it("combo multi-producto: exige que la candidata este habilitada para TODOS los grupos de material distintos", async () => {
    // Cocina (M74) + Horno (M75): dos productos, dos grupos de material.
    const comboInput: CuposEngineInput = { ...baseInput, productIds: ["10054511", "10099999"] };

    const client = clientFromRouter(async (path) => {
      if (path.includes("MaterialSalesProcessInformationCollection")) {
        if (path.includes("10054511")) return [{ ProductGroup2: "M74" }];
        if (path.includes("10099999")) return [{ ProductGroup2: "M75" }];
        return [];
      }
      if (path.includes("BO_RegionRootCollection")) return [region];
      if (path.includes("BO_CuposEmpresaRootCollection") && !path.includes("(")) return [candidateA, candidateB];
      if (path.includes("OBJ-A") && path.includes("CuposTipoServicio")) return [{ zIDTipoServicio: "CA_1" }];
      // Candidata A solo esta habilitada para M74 (cocina), no para M75 (horno) - debe descartarse.
      if (path.includes("OBJ-A") && path.includes("CuposGrupoMaterial") && path.includes("M74")) return [{ zCupIdGrupoMaterial: "M74" }];
      if (path.includes("OBJ-A") && path.includes("CuposGrupoMaterial") && path.includes("M75")) return [];
      if (path.includes("OBJ-A") && path.includes("CuposEmpresaFecha")) return [{ zCupFechLunes: true }];
      // Candidata B esta habilitada para ambos grupos.
      if (path.includes("OBJ-B") && path.includes("CuposTipoServicio")) return [{ zIDTipoServicio: "CA_1" }];
      if (path.includes("OBJ-B") && path.includes("CuposGrupoMaterial")) return [{ zCupIdGrupoMaterial: "M74" }];
      if (path.includes("OBJ-B") && path.includes("CuposEmpresaFecha")) return [{ zCupFechLunes: true }];
      if (path.includes("BO_CupoPorAreaRootCollection")) return [{ zCantidadDisponible: 3, zIdRegistro: "REG-B" }];
      return [];
    });

    const result = await assignCupo(comboInput, client);

    expect(result).toEqual({
      ok: true,
      companyId: "1305EXT",
      reservationId: "REG-B",
      cabRegion: region.zRegRegin,
      regionFsm: region.zRegcode,
      regionFsmId: region.zRegid,
    });
  });

  it("no pasa el chequeo de dia habilitado si zCupFechLunes es false para un lunes solicitado", async () => {
    const client = clientFromRouter(async (path) => {
      if (path.includes("MaterialSalesProcessInformationCollection")) return [{ ProductGroup2: "M74" }];
      if (path.includes("BO_RegionRootCollection")) return [region];
      if (path.includes("BO_CuposEmpresaRootCollection") && !path.includes("(")) return [candidateA];
      if (path.includes("CuposTipoServicio")) return [{ zIDTipoServicio: "CA_1" }];
      if (path.includes("CuposGrupoMaterial")) return [{ zCupIdGrupoMaterial: "M74" }];
      if (path.includes("CuposEmpresaFecha")) return [{ zCupFechLunes: false }];
      return [];
    });

    const result = await assignCupo(baseInput, client);
    expect(result).toEqual({ ok: false, reason: "NO_CAPACITY", detail: expect.any(String) });
  });
});

describe("getFechasDisponibles", () => {
  const baseFechasInput: FechasDisponiblesInput = {
    postalCode: "07021",
    regionCode: "15",
    desde: "2026-08-03", // lunes
    hasta: "2026-08-09", // domingo siguiente
  };

  it("devuelve [] si no hay region activa", async () => {
    const client = routedClient({ BO_RegionRootCollection: [] });
    const result = await getFechasDisponibles(baseFechasInput, client);
    expect(result).toEqual([]);
  });

  it("devuelve [] si no hay empresas candidatas", async () => {
    const client = routedClient({
      BO_RegionRootCollection: [region],
      BO_CuposEmpresaRootCollection: [],
    });
    const result = await getFechasDisponibles(baseFechasInput, client);
    expect(result).toEqual([]);
  });

  it("devuelve solo las fechas con cupo y dia de semana habilitado para alguna candidata elegible", async () => {
    const client = clientFromRouter(async (path) => {
      if (path.includes("BO_RegionRootCollection")) return [region];
      if (path.includes("BO_CuposEmpresaRootCollection") && !path.includes("(")) return [candidateA];
      // Candidata trabaja lunes y miercoles, no martes.
      if (path.includes("CuposEmpresaFecha")) return [{ zCupFechLunes: true, zCupFechMircoles: true }];
      if (path.includes("BO_CuposPorEmpresaPorFechaRootCollection")) {
        return [
          { zIdEmpresa: candidateA.zCupIdEmpresa, zFecha: "2026-08-03T00:00:00", zCantidadReal: 15 }, // lunes, con cupo
          { zIdEmpresa: candidateA.zCupIdEmpresa, zFecha: "2026-08-04T00:00:00", zCantidadReal: 20 }, // martes, con cupo pero no trabaja
          { zIdEmpresa: candidateA.zCupIdEmpresa, zFecha: "2026-08-05T00:00:00", zCantidadReal: 12 }, // miercoles, con cupo
        ];
      }
      return [];
    });

    const result = await getFechasDisponibles(baseFechasInput, client);
    expect(result).toEqual(["2026-08-03", "2026-08-05"]);
  });

  it("interpreta correctamente zFecha en formato JSON verbose de OData v2 (/Date(ms)/)", async () => {
    // Confirmado en vivo contra C4C produccion: el JSON que devuelve C4C serializa
    // zFecha como "/Date(<ms-epoch>)/", no como texto ISO.
    const client = clientFromRouter(async (path) => {
      if (path.includes("BO_RegionRootCollection")) return [region];
      if (path.includes("BO_CuposEmpresaRootCollection") && !path.includes("(")) return [candidateA];
      if (path.includes("CuposEmpresaFecha")) return [{ zCupFechLunes: true }];
      if (path.includes("BO_CuposPorEmpresaPorFechaRootCollection")) {
        return [
          // 2026-08-03T00:00:00Z en formato "/Date(ms-epoch)/" (lunes, con cupo).
          { zIdEmpresa: candidateA.zCupIdEmpresa, zFecha: "/Date(1785715200000)/", zCantidadReal: 15 },
        ];
      }
      return [];
    });

    const result = await getFechasDisponibles(baseFechasInput, client);
    expect(result).toEqual(["2026-08-03"]);
  });

  it("la consulta de capacidad filtra explicitamente por mas de 10 cupos reales disponibles", async () => {
    let capturedPath = "";
    const client = clientFromRouter(async (path) => {
      if (path.includes("BO_RegionRootCollection")) return [region];
      if (path.includes("BO_CuposEmpresaRootCollection") && !path.includes("(")) return [candidateA];
      if (path.includes("CuposEmpresaFecha")) return [{ zCupFechLunes: true }];
      if (path.includes("BO_CuposPorEmpresaPorFechaRootCollection")) {
        capturedPath = path;
        return [];
      }
      return [];
    });

    await getFechasDisponibles(baseFechasInput, client);
    expect(capturedPath).toContain(encodeURIComponent("zCantidadReal gt 10"));
  });

  it("filtra el limite superior de fechas client-side (sin incluir 'zFecha le' en el $filter)", async () => {
    let capturedPath = "";
    const client = clientFromRouter(async (path) => {
      if (path.includes("BO_RegionRootCollection")) return [region];
      if (path.includes("BO_CuposEmpresaRootCollection") && !path.includes("(")) return [candidateA];
      if (path.includes("CuposEmpresaFecha")) return [{ zCupFechLunes: true, zCupFechMircoles: true }];
      if (path.includes("BO_CuposPorEmpresaPorFechaRootCollection")) {
        capturedPath = path;
        return [
          { zIdEmpresa: candidateA.zCupIdEmpresa, zFecha: "2026-08-05T00:00:00", zCantidadReal: 15 }, // miercoles dentro del rango
          { zIdEmpresa: candidateA.zCupIdEmpresa, zFecha: "2026-08-10T00:00:00", zCantidadReal: 20 }, // domingo fuera del rango (> hasta)
        ];
      }
      return [];
    });

    const result = await getFechasDisponibles(baseFechasInput, client);
    expect(result).not.toContain("2026-08-10");
    expect(result).toContain("2026-08-05");
    const decodedPath = decodeURIComponent(capturedPath);
    expect(decodedPath).not.toContain("zFecha le");
  });

  it("usa semantica OR entre empresas elegibles (basta que una tenga cupo para incluir la fecha)", async () => {
    const client = clientFromRouter(async (path) => {
      if (path.includes("BO_RegionRootCollection")) return [region];
      if (path.includes("BO_CuposEmpresaRootCollection") && !path.includes("(")) return [candidateA, candidateB];
      if (path.includes("OBJ-A") && path.includes("CuposEmpresaFecha")) return [{ zCupFechLunes: true }];
      if (path.includes("OBJ-B") && path.includes("CuposEmpresaFecha")) return [{ zCupFechLunes: true }];
      if (path.includes("BO_CuposPorEmpresaPorFechaRootCollection")) {
        return [
          { zIdEmpresa: candidateB.zCupIdEmpresa, zFecha: "2026-08-03T00:00:00", zCantidadReal: 15 }, // lunes de B
        ];
      }
      return [];
    });

    const result = await getFechasDisponibles(baseFechasInput, client);
    expect(result).toContain("2026-08-03");
  });

  describe("cache en memoria por departamento/codigoPostal/rango de fechas", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    function clientReturningCupo(): IC4CODataClient {
      return clientFromRouter(async (path) => {
        if (path.includes("BO_RegionRootCollection")) return [region];
        if (path.includes("BO_CuposEmpresaRootCollection") && !path.includes("(")) return [candidateA];
        if (path.includes("CuposEmpresaFecha")) return [{ zCupFechLunes: true }];
        if (path.includes("BO_CuposPorEmpresaPorFechaRootCollection")) {
          return [{ zIdEmpresa: candidateA.zCupIdEmpresa, zFecha: "2026-08-03T00:00:00", zCantidadReal: 15 }];
        }
        return [];
      });
    }

    it("no vuelve a llamar a C4C para la misma combinacion dentro de la ventana de 10 minutos", async () => {
      const client = clientReturningCupo();

      const first = await getFechasDisponibles(baseFechasInput, client);
      const callsAfterFirst = (client.getCollection as ReturnType<typeof vi.fn>).mock.calls.length;
      const second = await getFechasDisponibles(baseFechasInput, client);

      expect(second).toEqual(first);
      expect((client.getCollection as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterFirst);
    });

    it("vuelve a consultar C4C despues de que expira el TTL de 10 minutos", async () => {
      const client = clientReturningCupo();

      await getFechasDisponibles(baseFechasInput, client);
      const callsAfterFirst = (client.getCollection as ReturnType<typeof vi.fn>).mock.calls.length;
      vi.advanceTimersByTime(10 * 60_000 + 1);
      await getFechasDisponibles(baseFechasInput, client);

      expect((client.getCollection as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(callsAfterFirst);
    });

    it("mantiene caches independientes para distinto departamento/codigoPostal/rango", async () => {
      const client = clientReturningCupo();

      await getFechasDisponibles(baseFechasInput, client);
      const callsAfterFirst = (client.getCollection as ReturnType<typeof vi.fn>).mock.calls.length;
      await getFechasDisponibles({ ...baseFechasInput, regionCode: "99" }, client);

      expect((client.getCollection as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(callsAfterFirst);
    });
  });

  describe("concurrencia acotada y manejo de errores en el fan-out por candidata", () => {
    it("propaga el rechazo si una candidata falla, y no lo cachea (reintenta en la siguiente llamada)", async () => {
      let shouldFail = true;
      const client = clientFromRouter(async (path) => {
        if (path.includes("BO_RegionRootCollection")) return [region];
        if (path.includes("BO_CuposEmpresaRootCollection") && !path.includes("(")) return [candidateA];
        if (path.includes("CuposEmpresaFecha")) {
          if (shouldFail) throw new Error("c4c down");
          return [{ zCupFechLunes: true }];
        }
        return [];
      });

      await expect(getFechasDisponibles(baseFechasInput, client)).rejects.toThrow("c4c down");
      const callsAfterFailure = (client.getCollection as ReturnType<typeof vi.fn>).mock.calls.length;

      // Una segunda llamada (ya sin la falla) no debe devolver un resultado
      // cacheado del intento fallido - debe volver a consultar C4C de cero.
      // Si el intento fallido se hubiera cacheado, esta llamada no generaria
      // ninguna solicitud nueva (mismo bug que se quiere evitar).
      shouldFail = false;
      await getFechasDisponibles(baseFechasInput, client);

      expect((client.getCollection as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(callsAfterFailure);
    });

    it("acota la concurrencia del fan-out a CANDIDATOS_CONCURRENCIA_MAXIMA (8) solicitudes simultaneas", async () => {
      const manyCandidates = Array.from({ length: 20 }, (_, i) => ({
        ObjectID: `OBJ-${i}`,
        zCupIdEmpresa: `EMP-${i}`,
        zCupPrioridadNEw: 1,
        zCupDepart: "15",
        zCupactivo: true,
      }));

      let inFlight = 0;
      let maxInFlight = 0;
      const client = clientFromRouter(async (path) => {
        if (path.includes("BO_RegionRootCollection")) return [region];
        if (path.includes("BO_CuposEmpresaRootCollection") && !path.includes("(")) return manyCandidates;
        if (path.includes("CuposEmpresaFecha")) {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 5));
          inFlight--;
          return [{ zCupFechLunes: true }];
        }
        return [];
      });

      await getFechasDisponibles(baseFechasInput, client);

      expect(maxInFlight).toBeLessThanOrEqual(8);
      expect(maxInFlight).toBeGreaterThan(1); // sigue habiendo paralelismo real, no secuencial puro.
    });
  });
});
