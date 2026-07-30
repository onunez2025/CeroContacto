# Reactivacion del calendario de fechas disponibles - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconectar el calendario de fechas disponibles del formulario contra los servicios OData reales de C4C produccion (`plantilla_cuposarea`, `cupos_x_empresa_x_fecha`, `cupos_empresa`), reemplazando el campo de fecha libre actual.

**Architecture:** El motor de cupos (`cuposEngine`) ya tenia la logica de "candidatas por departamento + dia habilitado + capacidad en un rango de fechas" implementada, pero apuntando a un servicio OData (`cupoporarea`) que nunca existio en produccion. Se corrige unicamente la parte de calculo de capacidad (`checkCapacidadRango`, usada solo por `getFechasDisponibles`) para usar `cupos_x_empresa_x_fecha`, y se elimina el filtro por grupo de material/tipo de servicio (dependia de `cust_producto` y un servicio que tampoco existe). La asignacion automatica de contratista (`assignCupo`) no se toca, sigue deshabilitada.

**Tech Stack:** TypeScript, Express, Vitest, React (sin cambios de stack).

## Global Constraints

- La ruta `/api/fechas-disponibles` NO tiene rate limiter hoy - se le agrega `createRateLimiter({ windowMs: 60_000, max: 60 })`, mismo patron ya usado en `/api/codigos-postales*`.
- El umbral de disponibilidad es `zCantidadReal > 10` (no `> 0`), igual que el diseno original.
- `assignCupo`, `checkCapacidad` (version de un solo dia) y sus tipos/pasos asociados (`getProductGroup`, `isTipoServicioHabilitado`, `isGrupoMaterialHabilitado`, `CuposEngineInput`, `CupoPorAreaRoot`) NO se modifican - siguen existiendo, sin usarse en ningun flujo activo.
- `getCandidateCompanies`, `getDiasHabilitados`, `isDiaHabilitado` (servicio `cupos_empresa`) NO cambian - ya son correctos.
- El parametro `productIds`/`productos` se elimina por completo de `FechasDisponiblesInput`, `getFechasDisponibles`, la ruta `/api/fechas-disponibles`, el cliente `api.ts` y el componente `FechaDisponibleCalendar` - ya no se usa en esta iteracion.
- Ningun test de integracion en vivo contra C4C - la verificacion en vivo (Task 5) la hace el controller/implementador manualmente, no un test automatizado.

---

### Task 1: Motor de cupos - servicios y campos reales de `getFechasDisponibles`

**Files:**
- Modify: `packages/backend/src/domain/cuposEngine/types.ts`
- Modify: `packages/backend/src/domain/cuposEngine/steps.ts`
- Modify: `packages/backend/src/domain/cuposEngine/index.ts`
- Modify: `packages/backend/src/domain/cuposEngine/cuposEngine.test.ts`

**Interfaces:**
- Consumes: `IC4CODataClient.getCollection<T>(path: string): Promise<T[]>` (sin cambios, ya existe en `@cerocontacto/c4c-client`).
- Produces: `getFechasDisponibles(input: FechasDisponiblesInput, client: IC4CODataClient): Promise<string[]>` - firma sin cambios, pero `FechasDisponiblesInput` ya NO tiene `productIds`. Task 2 consume esta funcion desde `app.ts` sin pasarle `productIds`.

- [ ] **Step 1: Actualizar `FechasDisponiblesInput` y `CupoPorAreaConFecha` en `types.ts`**

En `packages/backend/src/domain/cuposEngine/types.ts`, reemplazar el bloque `CupoPorAreaConFecha` (lineas 105-110) por:

```ts
export interface CupoPorAreaConFecha {
  zCantidadReal: number;
  zIdEmpresa: string;
  /** Formato "YYYY-MM-DDT00:00:00" tal como lo devuelve C4C (OData v2 datetime sin offset). */
  zFecha: string;
}
```

Y reemplazar `FechasDisponiblesInput` (lineas 112-120) por:

```ts
export interface FechasDisponiblesInput {
  postalCode: string;
  regionCode: string;
  /** ISO date (YYYY-MM-DD), inclusive. */
  desde: string;
  /** ISO date (YYYY-MM-DD), inclusive. */
  hasta: string;
}
```

Tambien actualizar el comentario de `SERVICE_AREA_ID` (linea 11), que decia "Instalacion" - corregirlo a:

```ts
/** Area de servicio "GENERAL" (confirmado en el ticket real 1394128 de C4C produccion, 2026-07-30). */
export const SERVICE_AREA_ID = "4";
```

- [ ] **Step 2: Escribir los tests que fallan en `cuposEngine.test.ts`**

En `packages/backend/src/domain/cuposEngine/cuposEngine.test.ts`, reemplazar TODO el bloque `describe("getFechasDisponibles", ...)` (lineas 192-363) por:

```ts
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
});
```

No tocar `describe("dayOfWeekIndex", ...)` ni `describe("assignCupo", ...)` - quedan exactamente igual.

- [ ] **Step 2b: Correr los tests y verificar que fallan**

Run: `npm run test --workspace=@cerocontacto/backend -- cuposEngine.test.ts`
Expected: FAIL - los tests de `getFechasDisponibles` fallan porque `steps.ts`/`index.ts` todavia consultan `cupoporarea`/`zCantidadDisponible`/filtros de tipo-servicio (los mocks nuevos no responden a esas rutas).

- [ ] **Step 3: Corregir `checkCapacidadRango` en `steps.ts`**

En `packages/backend/src/domain/cuposEngine/steps.ts`, reemplazar la funcion `checkCapacidadRango` completa (lineas 165-195) por:

```ts
/**
 * Version en rango de checkCapacidad: en vez de una fecha y una empresa,
 * trae en UNA sola consulta todos los registros de capacidad REAL (ya
 * descontando reservas) de varias empresas candidatas para un rango de
 * fechas, ya filtrados por "mas de 10 cupos disponibles". Se usa para
 * calcular que fechas mostrar habilitadas en el calendario, sin consultar
 * C4C dia por dia.
 *
 * Usa el servicio "cupos_x_empresa_x_fecha" (BO_CuposPorEmpresaPorFechaRoot),
 * confirmado en vivo contra produccion (2026-07-30) - NO "cupoporarea", que
 * nunca existio como servicio OData ("No implementation for service"). Este
 * servicio no tiene campo de "area" (a diferencia de "plantilla_cuposarea",
 * que si lo tiene pero no desglosa por departamento) - la capacidad real se
 * filtra solo por departamento + empresa + fecha + activo.
 */
export async function checkCapacidadRango(
  regionCode: string,
  companyIds: string[],
  desde: string,
  hasta: string,
  client: IC4CODataClient,
): Promise<CupoPorAreaConFecha[]> {
  if (companyIds.length === 0) return [];

  // C4C rechaza este $filter si se agrega tambien "zFecha le ..." (confirmado
  // en vivo contra produccion, 2026-07-30, mismo error que en el servicio
  // anterior: "Error in filter System Query, Operation failed:: Expression
  // can not converted into ABAP select options"). Un solo lado (ge) combinado
  // con el resto de campos si funciona, asi que el limite superior se filtra
  // aca en vez de en el $filter.
  const filter = and(
    eq("zDepartamento", regionCode),
    eqBool("zActivo", true),
    cmpRaw("zCantidadReal", "gt", "10"),
    or(...companyIds.map((id) => eq("zIdEmpresa", id))),
    cmpRaw("zFecha", "ge", `datetime'${desde}T00:00:00'`),
  );
  const results = await client.getCollection<CupoPorAreaConFecha>(
    `${CUST_NS}/cupos_x_empresa_x_fecha/BO_CuposPorEmpresaPorFechaRootCollection?$filter=${encodeURIComponent(filter)}&$select=zCantidadReal,zIdEmpresa,zFecha`,
  );
  return results
    .map((r) => ({ ...r, zFecha: parseODataJsonDate(r.zFecha) }))
    .filter((r) => r.zFecha <= hasta);
}
```

No modificar `checkCapacidad` (la version de un solo dia, usada solo por `assignCupo`) - queda igual, sigue apuntando a `cupoporarea` sin usarse en ningun flujo activo.

- [ ] **Step 4: Simplificar `getFechasDisponibles` en `index.ts`**

En `packages/backend/src/domain/cuposEngine/index.ts`, reemplazar la funcion `getFechasDisponibles` completa (lineas 99-152) por:

```ts
/**
 * Calcula que fechas del rango [input.desde, input.hasta] tienen mas de
 * 10 cupos reales disponibles para alguna empresa candidata del
 * departamento (activa y con el dia de semana habilitado). No filtra por
 * grupo de material/tipo de servicio: los servicios de C4C que harian
 * falta para eso (cust_producto, chequeo de tipo de servicio) no existen
 * en produccion todavia (confirmado en vivo, 2026-07-30) - ver
 * assignCupo, que si los necesita y por eso sigue deshabilitado. Se usa
 * para restringir el calendario del formulario; no reserva nada.
 */
export async function getFechasDisponibles(input: FechasDisponiblesInput, client: IC4CODataClient): Promise<string[]> {
  const region = await getRegionMeta(input.postalCode, client);
  if (!region?.zRegRegin) return [];
  const cabRegion = region.zRegRegin;

  const candidates = await getCandidateCompanies(input.regionCode, client);
  if (candidates.length === 0) return [];

  const elegibles: { zCupIdEmpresa: string; dias: Awaited<ReturnType<typeof getDiasHabilitados>> }[] = [];
  for (const candidate of candidates) {
    const dias = await getDiasHabilitados(candidate.ObjectID, input.regionCode, cabRegion, client);
    elegibles.push({ zCupIdEmpresa: candidate.zCupIdEmpresa, dias });
  }

  const cupos = await checkCapacidadRango(
    input.regionCode,
    elegibles.map((e) => e.zCupIdEmpresa),
    input.desde,
    input.hasta,
    client,
  );
  const fechasPorEmpresa = new Map<string, Set<string>>();
  for (const cupo of cupos) {
    if (!fechasPorEmpresa.has(cupo.zIdEmpresa)) fechasPorEmpresa.set(cupo.zIdEmpresa, new Set());
    fechasPorEmpresa.get(cupo.zIdEmpresa)?.add(cupo.zFecha.slice(0, 10));
  }

  const fechasDisponibles: string[] = [];
  for (let cursor = input.desde; cursor <= input.hasta; cursor = addDaysIso(cursor, 1)) {
    const weekday = DAY_FIELDS[dayOfWeekIndex(cursor)];
    const calificaAlguna = elegibles.some((empresa) => {
      if (!empresa.dias || weekday === undefined || empresa.dias[weekday] !== true) return false;
      return fechasPorEmpresa.get(empresa.zCupIdEmpresa)?.has(cursor) ?? false;
    });
    if (calificaAlguna) fechasDisponibles.push(cursor);
  }

  return fechasDisponibles;
}
```

No modificar la lista de imports en `index.ts` (`getProductGroup`, `isTipoServicioHabilitado`, `isGrupoMaterialHabilitado`, `checkCapacidad` siguen siendo usados por `assignCupo`, que no cambia) ni la funcion `assignCupo`.

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `npm run test --workspace=@cerocontacto/backend -- cuposEngine.test.ts`
Expected: PASS (todos los tests de `assignCupo`, `dayOfWeekIndex` y `getFechasDisponibles`).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck --workspace=@cerocontacto/backend` (o `npx tsc --noEmit` dentro de `packages/backend`)
Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/domain/cuposEngine/types.ts packages/backend/src/domain/cuposEngine/steps.ts packages/backend/src/domain/cuposEngine/index.ts packages/backend/src/domain/cuposEngine/cuposEngine.test.ts
git commit -m "Reconectar getFechasDisponibles contra los servicios reales de cupos (cupos_x_empresa_x_fecha)"
```

---

### Task 2: Ruta `/api/fechas-disponibles` - quitar `productos`, agregar rate limiter

**Files:**
- Modify: `packages/backend/src/app.ts`
- Modify: `packages/backend/src/app.test.ts`

**Interfaces:**
- Consumes: `getFechasDisponibles(input: FechasDisponiblesInput, client): Promise<string[]>` de Task 1 (ya sin `productIds`).
- Produces: `GET /api/fechas-disponibles?departamento=<str>&codigoPostal=<str>` -> `{ fechas: string[] }` (200) o `{ error: string }` (502) o `{}` (429 del rate limiter). Task 4 (frontend) consume esta ruta sin enviar `productos`.

- [ ] **Step 1: Escribir/actualizar los tests que fallan en `app.test.ts`**

En `packages/backend/src/app.test.ts`, reemplazar el test de la linea 113-122 por:

```ts
  it("GET /api/fechas-disponibles devuelve las fechas del motor de cupos", async () => {
    mockGetFechasDisponibles.mockResolvedValue(["2026-08-03", "2026-08-05"]);

    const res = await request(createApp()).get(
      "/api/fechas-disponibles?departamento=15&codigoPostal=07021",
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ fechas: ["2026-08-03", "2026-08-05"] });
  });
```

El test de la linea 124-130 ("sin parametros devuelve fechas vacias") queda igual, sin cambios.

Agregar, despues del test de la linea 130 (justo antes de `it("GET /api/codigos-postales devuelve...")`), un nuevo test:

```ts
  it("las rutas /api/fechas-disponibles comparten un limite de 60 solicitudes por minuto por IP", async () => {
    mockGetFechasDisponibles.mockResolvedValue([]);
    const app = createApp();

    for (let i = 0; i < 60; i++) {
      const res = await request(app).get("/api/fechas-disponibles?departamento=15&codigoPostal=07021");
      expect(res.status).toBe(200);
    }
    const res = await request(app).get("/api/fechas-disponibles?departamento=15&codigoPostal=07021");
    expect(res.status).toBe(429);
  });
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm run test --workspace=@cerocontacto/backend -- app.test.ts`
Expected: FAIL - el test de rate limit falla (no existe todavia), y el test de "devuelve las fechas" puede seguir pasando porque `productos` ya no se lee en el mock (pero se debe verificar tras el cambio de Step 3 que la ruta real no lo exige).

- [ ] **Step 3: Actualizar la ruta en `app.ts`**

En `packages/backend/src/app.ts`, reemplazar el bloque de la ruta (lineas 57-90) por lo siguiente (esto agrega un rate limiter nuevo y propio para esta ruta, declarado justo antes de ella; la declaracion existente de `postalCodesRateLimiter` en la linea 97 no se toca ni se mueve - queda donde esta, usada solo por las rutas `/api/codigos-postales*`):

```ts
  // 60/min: mismo patron que /api/codigos-postales* - esta ruta nunca tuvo
  // rate limiter porque el motor de cupos estaba deshabilitado y nunca se
  // ejecutaba de verdad (confirmado 2026-07-30, ver docs/superpowers/specs/
  // 2026-07-30-fechas-disponibles-reactivacion-design.md).
  const fechasDisponiblesRateLimiter = createRateLimiter({ windowMs: 60_000, max: 60 });

  app.get("/api/fechas-disponibles", fechasDisponiblesRateLimiter, async (req, res) => {
    const departamento = typeof req.query.departamento === "string" ? req.query.departamento : "";
    const codigoPostal = typeof req.query.codigoPostal === "string" ? req.query.codigoPostal : "";

    if (!departamento || !codigoPostal) {
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
```

Dejar la declaracion existente de `postalCodesRateLimiter` (para `/api/codigos-postales*`) exactamente donde esta, sin fusionarla con la nueva - son limiters independientes con baldes separados por ruta, igual que `customerLookupRateLimiter`.

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm run test --workspace=@cerocontacto/backend -- app.test.ts`
Expected: PASS (todos los tests del archivo, incluido el nuevo de rate limit).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit` dentro de `packages/backend`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/app.ts packages/backend/src/app.test.ts
git commit -m "Quitar parametro productos de /api/fechas-disponibles y agregarle rate limiter"
```

---

### Task 3: Cliente del frontend y componente de calendario - quitar `productIds`

**Files:**
- Modify: `packages/frontend/src/api.ts`
- Modify: `packages/frontend/src/FechaDisponibleCalendar.tsx`

**Interfaces:**
- Consumes: `GET /api/fechas-disponibles?departamento=<str>&codigoPostal=<str>` de Task 2.
- Produces: `getFechasDisponibles(departamento: string, codigoPostal: string): Promise<string[]>` y `<FechaDisponibleCalendar departamento codigoPostal value onChange whatsappUrl error />` (sin `productIds`) - consumidos por Task 4 en `App.tsx`.

No hay TDD aca (el paquete `frontend` no tiene test runner, confirmado en la verificacion de la feature anterior de este mismo proyecto - "frontend no tiene test script por diseno"). Los cambios se verifican con typecheck y con la verificacion manual de Task 5.

- [ ] **Step 1: Quitar `productIds` de `getFechasDisponibles` en `api.ts`**

En `packages/frontend/src/api.ts`, reemplazar la funcion (lineas 74-86) por:

```ts
export async function getFechasDisponibles(departamento: string, codigoPostal: string): Promise<string[]> {
  const params = new URLSearchParams({ departamento, codigoPostal });
  const res = await fetch(`/api/fechas-disponibles?${params.toString()}`);
  const body = (await res.json().catch(() => undefined)) as { fechas?: string[]; error?: string } | undefined;
  if (!res.ok) {
    throw new ApiError(body?.error ?? "No pudimos cargar las fechas disponibles.");
  }
  return body?.fechas ?? [];
}
```

- [ ] **Step 2: Quitar la prop `productIds` de `FechaDisponibleCalendar.tsx`**

En `packages/frontend/src/FechaDisponibleCalendar.tsx`:

Reemplazar la interfaz de props (lineas 50-58) por:

```ts
interface FechaDisponibleCalendarProps {
  departamento: string;
  codigoPostal: string;
  value: string;
  onChange: (fecha: string) => void;
  whatsappUrl: string;
  error?: string;
}
```

Reemplazar la firma del componente y el `useEffect` (lineas 62-101) por:

```ts
export function FechaDisponibleCalendar({
  departamento,
  codigoPostal,
  value,
  onChange,
  whatsappUrl,
  error,
}: FechaDisponibleCalendarProps) {
  const [fechas, setFechas] = useState<Set<string>>(new Set());
  const [estado, setEstado] = useState<Estado>("cargando");
  const [visibleMonth, setVisibleMonth] = useState<MesVisible | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    let cancelado = false;
    setEstado("cargando");

    getFechasDisponibles(departamento, codigoPostal)
      .then((lista) => {
        if (cancelado) return;
        setFechas(new Set(lista));
        setEstado(lista.length > 0 ? "listo" : "vacio");
        if (lista.length > 0) {
          const primera = new Date(`${lista[0]}T00:00:00Z`);
          setVisibleMonth({ year: primera.getUTCFullYear(), month: primera.getUTCMonth() });
        }
      })
      .catch((err: unknown) => {
        if (cancelado) return;
        setEstado("error");
        if (!(err instanceof ApiError)) console.error("fechas_disponibles_fetch_failed", err);
      });

    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departamento, codigoPostal, retryToken]);
```

El resto del componente (los `if (estado === ...)` y el JSX del calendario) no cambia.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit` dentro de `packages/frontend`
Expected: errores esperados en `App.tsx` (todavia no usa el componente actualizado) - eso se corrige en Task 4. Confirmar que `api.ts` y `FechaDisponibleCalendar.tsx` en si no tienen errores propios (revisar que los unicos errores reportados sean por el uso en `App.tsx`, si lo hay).

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/api.ts packages/frontend/src/FechaDisponibleCalendar.tsx
git commit -m "Quitar productIds del cliente y componente de fechas disponibles"
```

---

### Task 4: Reconectar el calendario en `App.tsx`

**Files:**
- Modify: `packages/frontend/src/App.tsx`

**Interfaces:**
- Consumes: `<FechaDisponibleCalendar departamento codigoPostal value onChange whatsappUrl error />` de Task 3.

- [ ] **Step 1: Importar el componente**

En `packages/frontend/src/App.tsx`, agregar el import despues de la linea 19 (`import { ProductoPicker } from "./ProductoPicker.js";`):

```ts
import { FechaDisponibleCalendar } from "./FechaDisponibleCalendar.js";
```

- [ ] **Step 2: Reemplazar el campo de fecha libre**

Reemplazar el bloque completo de las lineas 884-903 (el `<div className="field">` que contiene el comentario de deshabilitacion y el `<input type="date">`) por:

```tsx
            <div className="field">
              <label>Fecha deseada</label>
              <FechaDisponibleCalendar
                departamento={form.direccion.departamento}
                codigoPostal={form.direccion.codigoPostal}
                value={form.fechaVisita}
                onChange={(fecha) => update("fechaVisita", fecha)}
                whatsappUrl={WHATSAPP_URL}
                error={fieldErrors.fechaVisita}
              />
              <p className="hint">Fecha tentativa, sujeta a disponibilidad de cupos - un asesor confirmara la fecha y el tecnico asignado por WhatsApp o email.</p>
            </div>
```

(El componente ya renderiza su propio `<FieldError>` internamente para el estado "listo" - no duplicar `<FieldError message={fieldErrors.fechaVisita} />` fuera de el.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit` dentro de `packages/frontend`
Expected: sin errores en ningun paquete.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/App.tsx
git commit -m "Reconectar FechaDisponibleCalendar en el paso 4 del formulario"
```

---

### Task 5: Verificacion completa (controller-executed, no subagent)

No es una tarea para dispatch - la ejecuta el controller/implementador directamente, igual que la Task 5 de la feature "buscador-codigo-postal" de este mismo proyecto.

- [ ] Typecheck de los 4 paquetes (`shared`, `c4c-client`, `backend`, `frontend`).
- [ ] Suite completa de tests del backend (`npm run test --workspace=@cerocontacto/backend`) - confirmar que sigue en verde, sin regresiones en `cuposEngine.test.ts`, `app.test.ts` ni ningun otro archivo.
- [ ] Verificacion manual en vivo contra produccion (dev server + backend local con credenciales reales, igual que las features anteriores de este proyecto):
  - Elegir un departamento con candidatas activas conocidas (ej. Lima, "15") y confirmar que el calendario muestra el estado "cargando" y luego "listo" con algunas fechas habilitadas.
  - Confirmar que las fechas mostradas como disponibles coinciden con lo esperado dado `zCantidadReal > 10` para alguna empresa candidata ese dia (contrastar con una consulta directa a `cupos_x_empresa_x_fecha` para el mismo departamento/rango).
  - Cambiar de departamento y confirmar que el calendario recarga (estado "cargando" de nuevo) y no arrastra fechas del departamento anterior.
  - Probar un departamento sin candidatas o sin capacidad (si existe alguno real) y confirmar el estado "vacio" con el link de WhatsApp.
  - Confirmar que despues de 60 solicitudes en un minuto a `/api/fechas-disponibles` desde el navegador (o con una herramienta como curl en un loop) se recibe 429.
- [ ] Reportar cualquier hallazgo (bug real, dato inesperado) igual que se hizo en la Task 5 de "buscador-codigo-postal" - no dar la tarea por cerrada solo con tests unitarios en verde.
