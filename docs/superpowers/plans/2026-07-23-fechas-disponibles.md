# Calendario con Fechas Disponibles - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restringir el selector de "Fecha de visita" del formulario (paso 4) para que el cliente solo pueda elegir fechas con cupos reales disponibles en C4C, en vez de cualquier fecha.

**Architecture:** Nueva funcion de dominio `getFechasDisponibles` en el motor de cupos existente (`packages/backend/src/domain/cuposEngine/`), expuesta via un nuevo endpoint `GET /api/fechas-disponibles`. Calcula disponibilidad para un rango de 6 semanas con una sola consulta agregada a C4C (no una consulta por dia), reutilizando los pasos ya existentes del motor de cupos (grupo de material, region, empresas candidatas, habilitaciones). El frontend reemplaza el `<input type="date">` actual por un calendario propio en React (sin dependencias nuevas) que solo permite click en los dias devueltos por el endpoint.

**Tech Stack:** TypeScript, Express (backend), React + Vite (frontend), Vitest (tests backend), fetch nativo (sin librerias HTTP nuevas), sin librerias de date-picker.

## Global Constraints

- El umbral de disponibilidad es **estrictamente mayor a 10 cupos** (`zCantidadDisponible gt 10`) para una empresa candidata individual - no es una suma entre empresas.
- El rango de busqueda es de **42 dias (6 semanas)**, empezando **mañana** (no incluye el dia de hoy).
- Cero dependencias nuevas de npm en frontend ni backend.
- El motor de cupos real (`assignCupo`), usado al enviar la solicitud, no se modifica - `getFechasDisponibles` es una funcion nueva y separada, de solo lectura.
- Si no se puede resolver grupo de material, region, o empresas candidatas, `getFechasDisponibles` devuelve `[]` (nunca lanza excepcion por falta de datos de negocio) - errores de configuracion/conectividad con C4C si se propagan como error HTTP 502, igual que `/api/productos`.
- Spec de referencia: `docs/superpowers/specs/2026-07-23-fechas-disponibles-design.md`.

---

## File Structure

**Backend:**
- Modify: `packages/c4c-client/src/odataFilter.ts` - agrega helpers `or()` y `cmpRaw()` para construir el filtro de rango+multi-empresa.
- Modify: `packages/backend/src/domain/cuposEngine/types.ts` - agrega `FechasDisponiblesInput` y `CupoPorAreaConFecha`.
- Modify: `packages/backend/src/domain/cuposEngine/steps.ts` - agrega `addDaysIso`, `getDiasHabilitados` (y refactoriza `isDiaHabilitado` para reusarlo), `checkCapacidadRango`.
- Modify: `packages/backend/src/domain/cuposEngine/index.ts` - agrega `getFechasDisponibles`.
- Modify: `packages/backend/src/domain/cuposEngine/cuposEngine.test.ts` - nuevos casos para `getFechasDisponibles`.
- Modify: `packages/backend/src/app.ts` - agrega `GET /api/fechas-disponibles`.
- Modify: `packages/backend/src/app.test.ts` - nuevo caso para el endpoint.

**Frontend:**
- Modify: `packages/frontend/src/api.ts` - agrega `getFechasDisponibles`.
- Create: `packages/frontend/src/FechaDisponibleCalendar.tsx` - componente de calendario.
- Modify: `packages/frontend/src/App.tsx` - reemplaza el `<input type="date">` del paso 4 por el nuevo componente.
- Modify: `packages/frontend/src/styles.css` - estilos del calendario.

---

### Task 1: Helpers de filtro OData + pasos nuevos del motor de cupos

**Files:**
- Modify: `packages/c4c-client/src/odataFilter.ts`
- Modify: `packages/backend/src/domain/cuposEngine/types.ts`
- Modify: `packages/backend/src/domain/cuposEngine/steps.ts`

**Interfaces:**
- Produces: `or(...clauses: string[]): string`, `cmpRaw(field: string, operator: "gt" | "ge" | "le" | "lt", rawValue: string): string` (exportados desde `@cerocontacto/c4c-client`).
- Produces: `FechasDisponiblesInput`, `CupoPorAreaConFecha` (exportados desde `packages/backend/src/domain/cuposEngine/types.ts`).
- Produces: `addDaysIso(isoDate: string, days: number): string`, `getDiasHabilitados(objectId: string, regionCode: string, cabRegion: string, client: IC4CODataClient): Promise<CuposEmpresaCuposEmpresaFecha | undefined>`, `checkCapacidadRango(regionCode: string, companyIds: string[], desde: string, hasta: string, client: IC4CODataClient): Promise<CupoPorAreaConFecha[]>` (exportados desde `packages/backend/src/domain/cuposEngine/steps.js`).
- Consumes: nada nuevo de otras tareas - esta tarea es la base.

- [ ] **Step 1: Agregar `or()` y `cmpRaw()` a `odataFilter.ts`**

Edita `packages/c4c-client/src/odataFilter.ts` y agrega al final del archivo:

```ts
export function cmpRaw(field: string, operator: "gt" | "ge" | "le" | "lt", rawValue: string): string {
  return `${field} ${operator} ${rawValue}`;
}

/** Junta clausulas con OR, envolviendo en parentesis solo si hay mas de una. */
export function or(...clauses: string[]): string {
  const filtered = clauses.filter(Boolean);
  if (filtered.length <= 1) return filtered[0] ?? "";
  return `(${filtered.join(" or ")})`;
}
```

- [ ] **Step 2: Typecheck de c4c-client**

Run: `npm run typecheck --workspace=packages/c4c-client`
Expected: sin errores (los helpers nuevos no rompen nada existente).

- [ ] **Step 3: Agregar tipos nuevos a `cuposEngine/types.ts`**

Edita `packages/backend/src/domain/cuposEngine/types.ts` y agrega al final del archivo:

```ts
export interface CupoPorAreaConFecha {
  zCantidadDisponible: number;
  zIdEmpresa: string;
  /** Formato "YYYY-MM-DDT00:00:00" tal como lo devuelve C4C (OData v2 datetime sin offset). */
  zFecha: string;
}

export interface FechasDisponiblesInput {
  productIds: string[];
  postalCode: string;
  regionCode: string;
  /** ISO date (YYYY-MM-DD), inclusive. */
  desde: string;
  /** ISO date (YYYY-MM-DD), inclusive. */
  hasta: string;
}
```

- [ ] **Step 4: Agregar `addDaysIso` y refactorizar `isDiaHabilitado` para reusar un nuevo `getDiasHabilitados`**

Edita `packages/backend/src/domain/cuposEngine/steps.ts`. Primero, cambia el import del inicio del archivo para incluir `or` y `cmpRaw`:

```ts
import { and, eq, eqBool, eqRaw, cmpRaw, or } from "@cerocontacto/c4c-client";
```

Luego agrega, justo despues de `dayOfWeekIndex` (despues de su cierre `}`):

```ts
export function addDaysIso(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
```

Ahora reemplaza la funcion `isDiaHabilitado` completa (busca el bloque que empieza en `export async function isDiaHabilitado(`) por estas dos funciones:

```ts
/**
 * Trae el registro completo de dias habilitados (los 7 flags) para una
 * candidata+region, sin evaluar ningun dia en particular - permite
 * reusar el mismo registro para varias fechas sin volver a consultar C4C.
 */
export async function getDiasHabilitados(
  objectId: string,
  regionCode: string,
  cabRegion: string,
  client: IC4CODataClient,
): Promise<CuposEmpresaCuposEmpresaFecha | undefined> {
  const filter = and(eq("zCupFechDepartamento", regionCode), eq("zCupFechRegin", cabRegion));
  const results = await client.getCollection<CuposEmpresaCuposEmpresaFecha>(
    `${CUST_NS}/cupos_empresa/BO_CuposEmpresaRootCollection('${objectId}')/BO_CuposEmpresaCuposEmpresaFecha?$filter=${encodeURIComponent(filter)}`,
  );
  return results[0];
}

/**
 * Se evalua sobre la FECHA DE VISITA SOLICITADA (no la fecha actual del
 * sistema) - el spec del proveedor es ambiguo en esto (su script de
 * Postman usa `new Date().getDay()`, el dia en que se ejecuta la prueba),
 * pero el chequeo tiene sentido de negocio como "el contratista trabaja
 * ese dia de la semana", que solo aplica al dia de la visita. Confirmar
 * con el proveedor (pregunta E de la seccion de motor de cupos).
 */
export async function isDiaHabilitado(
  objectId: string,
  regionCode: string,
  cabRegion: string,
  fechaVisita: string,
  client: IC4CODataClient,
): Promise<boolean> {
  const record = await getDiasHabilitados(objectId, regionCode, cabRegion, client);
  if (!record) return false;

  const field = DAY_FIELDS[dayOfWeekIndex(fechaVisita)];
  return field !== undefined && record[field] === true;
}
```

Por ultimo, agrega `checkCapacidadRango` al final del archivo (despues de `checkCapacidad`):

```ts
/**
 * Version en rango de checkCapacidad: en vez de una fecha y una empresa,
 * trae en UNA sola consulta todos los registros de capacidad de varias
 * empresas candidatas para un rango de fechas, ya filtrados por
 * "mas de 10 cupos disponibles". Se usa para calcular que fechas mostrar
 * habilitadas en el calendario, sin consultar C4C dia por dia.
 */
export async function checkCapacidadRango(
  regionCode: string,
  companyIds: string[],
  desde: string,
  hasta: string,
  client: IC4CODataClient,
): Promise<CupoPorAreaConFecha[]> {
  if (companyIds.length === 0) return [];

  const filter = and(
    eq("zIdArea", SERVICE_AREA_ID),
    eq("zDepartamento", regionCode),
    eqBool("zActivo", true),
    cmpRaw("zCantidadDisponible", "gt", "10"),
    or(...companyIds.map((id) => eq("zIdEmpresa", id))),
    cmpRaw("zFecha", "ge", `datetime'${desde}T00:00:00'`),
    cmpRaw("zFecha", "le", `datetime'${hasta}T00:00:00'`),
  );
  return client.getCollection<CupoPorAreaConFecha>(
    `${CUST_NS}/cupoporarea/BO_CupoPorAreaRootCollection?$filter=${encodeURIComponent(filter)}&$select=zCantidadDisponible,zIdEmpresa,zFecha`,
  );
}
```

Y agrega el import del nuevo tipo `CupoPorAreaConFecha` junto a los demas imports de tipos al inicio del archivo (busca la linea `import type { ... } from "./types.js";` y agrega `CupoPorAreaConFecha` a la lista).

- [ ] **Step 5: Typecheck y correr la suite existente (regresion del refactor de `isDiaHabilitado`)**

Run: `npm run typecheck --workspace=packages/backend`
Expected: sin errores.

Run: `npm test --workspace=packages/backend -- cuposEngine`
Expected: los 8 tests existentes en `cuposEngine.test.ts` siguen pasando (el refactor de `isDiaHabilitado` no cambia su comportamiento externo).

- [ ] **Step 6: Commit**

```bash
git add packages/c4c-client/src/odataFilter.ts packages/backend/src/domain/cuposEngine/types.ts packages/backend/src/domain/cuposEngine/steps.ts
git commit -m "Agregar helpers de filtro y pasos base para calcular fechas disponibles"
```

---

### Task 2: `getFechasDisponibles` en el motor de cupos (TDD)

**Files:**
- Modify: `packages/backend/src/domain/cuposEngine/index.ts`
- Modify: `packages/backend/src/domain/cuposEngine/cuposEngine.test.ts`

**Interfaces:**
- Consumes: todo lo de Task 1 (`FechasDisponiblesInput`, `CupoPorAreaConFecha`, `addDaysIso`, `getDiasHabilitados`, `checkCapacidadRango`, y las funciones ya existentes `getProductGroup`, `getRegionMeta`, `getCandidateCompanies`, `isTipoServicioHabilitado`, `isGrupoMaterialHabilitado`, `DAY_FIELDS`, `dayOfWeekIndex`).
- Produces: `getFechasDisponibles(input: FechasDisponiblesInput, client: IC4CODataClient): Promise<string[]>` (exportado desde `packages/backend/src/domain/cuposEngine/index.js`), usado por Task 3.

- [ ] **Step 1: Escribir los tests que fallan**

Edita `packages/backend/src/domain/cuposEngine/cuposEngine.test.ts`. Cambia el import del inicio (linea 3) para incluir la nueva funcion:

```ts
import { assignCupo, getFechasDisponibles } from "./index.js";
```

Y el import de tipos (linea 5) para incluir el nuevo tipo:

```ts
import type { CuposEngineInput, FechasDisponiblesInput } from "./types.js";
```

Agrega al final del archivo, antes del cierre final (despues del ultimo `});` que cierra `describe("assignCupo", ...)`):

```ts

describe("getFechasDisponibles", () => {
  const baseFechasInput: FechasDisponiblesInput = {
    productIds: ["10054511"],
    postalCode: "07021",
    regionCode: "15",
    desde: "2026-08-03", // lunes
    hasta: "2026-08-09", // domingo siguiente
  };

  it("devuelve [] si no se resuelve el grupo de material", async () => {
    const client = routedClient({ MaterialSalesProcessInformationCollection: [] });
    const result = await getFechasDisponibles(baseFechasInput, client);
    expect(result).toEqual([]);
  });

  it("devuelve [] si no hay region activa", async () => {
    const client = routedClient({
      MaterialSalesProcessInformationCollection: [{ ProductGroup2: "M74" }],
      BO_RegionRootCollection: [],
    });
    const result = await getFechasDisponibles(baseFechasInput, client);
    expect(result).toEqual([]);
  });

  it("devuelve [] si no hay empresas candidatas", async () => {
    const client = routedClient({
      MaterialSalesProcessInformationCollection: [{ ProductGroup2: "M74" }],
      BO_RegionRootCollection: [region],
      BO_CuposEmpresaRootCollection: [],
    });
    const result = await getFechasDisponibles(baseFechasInput, client);
    expect(result).toEqual([]);
  });

  it("devuelve [] si ninguna candidata pasa tipo de servicio o grupo de material", async () => {
    const client = clientFromRouter(async (path) => {
      if (path.includes("MaterialSalesProcessInformationCollection")) return [{ ProductGroup2: "M74" }];
      if (path.includes("BO_RegionRootCollection")) return [region];
      if (path.includes("BO_CuposEmpresaRootCollection") && !path.includes("(")) return [candidateA];
      if (path.includes("CuposTipoServicio")) return [];
      return [];
    });
    const result = await getFechasDisponibles(baseFechasInput, client);
    expect(result).toEqual([]);
  });

  it("devuelve solo las fechas con cupo y dia de semana habilitado para alguna candidata elegible", async () => {
    const client = clientFromRouter(async (path) => {
      if (path.includes("MaterialSalesProcessInformationCollection")) return [{ ProductGroup2: "M74" }];
      if (path.includes("BO_RegionRootCollection")) return [region];
      if (path.includes("BO_CuposEmpresaRootCollection") && !path.includes("(")) return [candidateA];
      if (path.includes("CuposTipoServicio")) return [{ zIDTipoServicio: "CA_1" }];
      if (path.includes("CuposGrupoMaterial")) return [{ zCupIdGrupoMaterial: "M74" }];
      // Candidata trabaja lunes y miercoles, no martes.
      if (path.includes("CuposEmpresaFecha")) return [{ zCupFechLunes: true, zCupFechMircoles: true }];
      if (path.includes("BO_CupoPorAreaRootCollection")) {
        return [
          { zIdEmpresa: candidateA.zCupIdEmpresa, zFecha: "2026-08-03T00:00:00", zCantidadDisponible: 15 }, // lunes, con cupo
          { zIdEmpresa: candidateA.zCupIdEmpresa, zFecha: "2026-08-04T00:00:00", zCantidadDisponible: 20 }, // martes, con cupo pero no trabaja
          { zIdEmpresa: candidateA.zCupIdEmpresa, zFecha: "2026-08-05T00:00:00", zCantidadDisponible: 12 }, // miercoles, con cupo
        ];
      }
      return [];
    });

    const result = await getFechasDisponibles(baseFechasInput, client);
    expect(result).toEqual(["2026-08-03", "2026-08-05"]);
  });

  it("la consulta de capacidad filtra explicitamente por mas de 10 cupos disponibles", async () => {
    let capturedPath = "";
    const client = clientFromRouter(async (path) => {
      if (path.includes("MaterialSalesProcessInformationCollection")) return [{ ProductGroup2: "M74" }];
      if (path.includes("BO_RegionRootCollection")) return [region];
      if (path.includes("BO_CuposEmpresaRootCollection") && !path.includes("(")) return [candidateA];
      if (path.includes("CuposTipoServicio")) return [{ zIDTipoServicio: "CA_1" }];
      if (path.includes("CuposGrupoMaterial")) return [{ zCupIdGrupoMaterial: "M74" }];
      if (path.includes("CuposEmpresaFecha")) return [{ zCupFechLunes: true }];
      if (path.includes("BO_CupoPorAreaRootCollection")) {
        capturedPath = path;
        return [];
      }
      return [];
    });

    await getFechasDisponibles(baseFechasInput, client);
    expect(capturedPath).toContain(encodeURIComponent("zCantidadDisponible gt 10"));
  });
});
```

- [ ] **Step 2: Correr los tests nuevos y verificar que fallan**

Run: `npm test --workspace=packages/backend -- cuposEngine`
Expected: FAIL - `getFechasDisponibles is not a function` o `is not exported` (todavia no existe).

- [ ] **Step 3: Exportar `DAY_FIELDS` desde `steps.ts`**

Edita `packages/backend/src/domain/cuposEngine/steps.ts` y busca la linea `const DAY_FIELDS = [` - cambiala a:

```ts
export const DAY_FIELDS = [
```

- [ ] **Step 4: Implementar `getFechasDisponibles`**

Edita `packages/backend/src/domain/cuposEngine/index.ts`. Cambia el import del inicio para incluir los pasos y el array nuevos:

```ts
import {
  addDaysIso,
  checkCapacidad,
  checkCapacidadRango,
  DAY_FIELDS,
  dayOfWeekIndex,
  getCandidateCompanies,
  getDiasHabilitados,
  getProductGroup,
  getRegionMeta,
  isDiaHabilitado,
  isGrupoMaterialHabilitado,
  isTipoServicioHabilitado,
} from "./steps.js";
import type { CuposEngineInput, CuposEngineResult, FechasDisponiblesInput } from "./types.js";
```

Agrega al final del archivo, despues del cierre de `assignCupo`:

```ts

/**
 * Calcula que fechas del rango [input.desde, input.hasta] tienen mas de
 * 10 cupos disponibles para alguna empresa candidata elegible (mismos
 * chequeos de habilitacion que assignCupo, pero de solo lectura - no
 * reserva nada). Se usa para restringir el calendario del formulario;
 * `assignCupo` sigue siendo la unica fuente de verdad al enviar la
 * solicitud real.
 */
export async function getFechasDisponibles(input: FechasDisponiblesInput, client: IC4CODataClient): Promise<string[]> {
  const productGroups = new Set<string>();
  for (const productId of input.productIds) {
    const group = await getProductGroup(productId, client);
    if (!group) return [];
    productGroups.add(group);
  }
  const distinctGroups = [...productGroups];

  const region = await getRegionMeta(input.postalCode, client);
  if (!region?.zRegRegin) return [];
  const cabRegion = region.zRegRegin;

  const candidates = await getCandidateCompanies(input.regionCode, client);
  if (candidates.length === 0) return [];

  const elegibles: { zCupIdEmpresa: string; dias: Awaited<ReturnType<typeof getDiasHabilitados>> }[] = [];
  for (const candidate of candidates) {
    const [tipoServicioOk, grupoMaterialChecks] = await Promise.all([
      isTipoServicioHabilitado(candidate.ObjectID, client),
      Promise.all(distinctGroups.map((group) => isGrupoMaterialHabilitado(candidate.ObjectID, group, client))),
    ]);
    if (!tipoServicioOk || !grupoMaterialChecks.every(Boolean)) continue;

    const dias = await getDiasHabilitados(candidate.ObjectID, input.regionCode, cabRegion, client);
    elegibles.push({ zCupIdEmpresa: candidate.zCupIdEmpresa, dias });
  }
  if (elegibles.length === 0) return [];

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

- [ ] **Step 5: Typecheck y correr los tests**

Run: `npm run typecheck --workspace=packages/backend`
Expected: sin errores.

Run: `npm test --workspace=packages/backend -- cuposEngine`
Expected: PASS - los 6 tests nuevos de `getFechasDisponibles` y los 8 existentes de `assignCupo`/`dayOfWeekIndex` (14 en total en el archivo).

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/domain/cuposEngine/index.ts packages/backend/src/domain/cuposEngine/steps.ts packages/backend/src/domain/cuposEngine/cuposEngine.test.ts
git commit -m "Agregar getFechasDisponibles al motor de cupos"
```

---

### Task 3: Endpoint `GET /api/fechas-disponibles`

**Files:**
- Modify: `packages/backend/src/app.ts`
- Modify: `packages/backend/src/app.test.ts`

**Interfaces:**
- Consumes: `getFechasDisponibles` de Task 2, `buildC4CClientFromEnv` de `packages/backend/src/config.ts` (ya existente).
- Produces: `GET /api/fechas-disponibles?departamento=&codigoPostal=&productos=` → `{ fechas: string[] }`, consumido por el frontend en Task 4.

- [ ] **Step 1: Escribir el test que falla**

Edita `packages/backend/src/app.test.ts`. Agrega el mock de `getFechasDisponibles` junto a los mocks existentes al inicio del archivo (despues del bloque `vi.mock("./infra/auditLog.js", ...)`):

```ts
const { mockGetFechasDisponibles } = vi.hoisted(() => ({ mockGetFechasDisponibles: vi.fn() }));

vi.mock("./domain/cuposEngine/index.js", () => ({
  getFechasDisponibles: mockGetFechasDisponibles,
}));
```

Y en el `afterEach`, agrega el reset de este nuevo mock (junto a `mockOrchestration.mockReset();`):

```ts
    mockGetFechasDisponibles.mockReset();
```

Agrega el nuevo test al final del `describe("createApp", ...)`, antes del cierre final:

```ts

  it("GET /api/fechas-disponibles devuelve las fechas del motor de cupos", async () => {
    mockGetFechasDisponibles.mockResolvedValue(["2026-08-03", "2026-08-05"]);

    const res = await request(createApp()).get(
      "/api/fechas-disponibles?departamento=15&codigoPostal=07021&productos=10054511",
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ fechas: ["2026-08-03", "2026-08-05"] });
  });

  it("GET /api/fechas-disponibles sin parametros devuelve fechas vacias sin llamar a C4C", async () => {
    const res = await request(createApp()).get("/api/fechas-disponibles");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ fechas: [] });
    expect(mockGetFechasDisponibles).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test --workspace=packages/backend -- app.test`
Expected: FAIL - `404` en vez de `200` (la ruta todavia no existe).

- [ ] **Step 3: Implementar la ruta**

Edita `packages/backend/src/app.ts`. Cambia el import del inicio (linea 4) para incluir la nueva funcion:

```ts
import { getFechasDisponibles } from "./domain/cuposEngine/index.js";
import { PRODUCT_CATEGORIES, searchProducts } from "./domain/productCatalog/index.js";
```

Agrega la nueva ruta despues de la ruta `/api/productos` existente, antes del middleware de manejo de errores (`app.use((err: unknown, ...`):

```ts
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
```

Esta ruta usa `buildC4CClientFromEnv`, que todavia no esta importado en `app.ts` - agregalo al import existente de `./config.js`:

```ts
import { buildC4CClientFromEnv, buildProductCatalogClientFromEnv } from "./config.js";
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm test --workspace=packages/backend -- app.test`
Expected: PASS - los 2 tests nuevos y los 3 existentes (5 en total).

Run: `npm run typecheck --workspace=packages/backend`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/app.ts packages/backend/src/app.test.ts
git commit -m "Agregar endpoint GET /api/fechas-disponibles"
```

---

### Task 4: Cliente frontend para el endpoint nuevo

**Files:**
- Modify: `packages/frontend/src/api.ts`

**Interfaces:**
- Produces: `getFechasDisponibles(departamento: string, codigoPostal: string, productIds: string[]): Promise<string[]>`, usado por Task 5.

- [ ] **Step 1: Agregar la funcion**

Edita `packages/frontend/src/api.ts` y agrega al final del archivo:

```ts
/** Fechas (ISO) con cupos reales disponibles, para restringir el calendario del paso 4. */
export async function getFechasDisponibles(
  departamento: string,
  codigoPostal: string,
  productIds: string[],
): Promise<string[]> {
  const params = new URLSearchParams({ departamento, codigoPostal, productos: productIds.join(",") });
  const res = await fetch(`/api/fechas-disponibles?${params.toString()}`);
  const body = (await res.json().catch(() => undefined)) as { fechas?: string[]; error?: string } | undefined;
  if (!res.ok) {
    throw new ApiError(body?.error ?? "No pudimos cargar las fechas disponibles.");
  }
  return body?.fechas ?? [];
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck --workspace=packages/frontend`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/api.ts
git commit -m "Agregar cliente frontend para fechas disponibles"
```

---

### Task 5: Componente de calendario

**Files:**
- Create: `packages/frontend/src/FechaDisponibleCalendar.tsx`

**Interfaces:**
- Consumes: `getFechasDisponibles` de Task 4, `ApiError` de `./api.js`, `FieldError` de `./FieldError.js`.
- Produces: componente `FechaDisponibleCalendar` con props `{ departamento: string; codigoPostal: string; productIds: string[]; value: string; onChange: (fecha: string) => void; whatsappUrl: string; error?: string }`, usado por Task 6.

- [ ] **Step 1: Crear el componente completo**

Crea `packages/frontend/src/FechaDisponibleCalendar.tsx`:

```tsx
import { useEffect, useState } from "react";
import { ApiError, getFechasDisponibles } from "./api.js";
import { FieldError } from "./FieldError.js";

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const DIAS_SEMANA = ["L", "M", "X", "J", "V", "S", "D"];

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDaysIso(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

/** Lunes=0..Domingo=6, para alinear la grilla con semana empezando en lunes. */
function mondayIndex(isoDate: string): number {
  const jsDay = new Date(`${isoDate}T00:00:00Z`).getUTCDay(); // 0=Domingo..6=Sabado
  return (jsDay + 6) % 7;
}

interface MonthCell {
  iso: string;
  inMonth: boolean;
}

function buildMonthGrid(year: number, month: number): MonthCell[] {
  const firstOfMonth = toIsoDate(new Date(Date.UTC(year, month, 1)));
  const leadingBlanks = mondayIndex(firstOfMonth);
  const gridStart = addDaysIso(firstOfMonth, -leadingBlanks);
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const totalCells = Math.ceil((leadingBlanks + daysInMonth) / 7) * 7;

  return Array.from({ length: totalCells }, (_, i) => {
    const iso = addDaysIso(gridStart, i);
    return { iso, inMonth: new Date(`${iso}T00:00:00Z`).getUTCMonth() === month };
  });
}

interface MesVisible {
  year: number;
  month: number;
}

interface FechaDisponibleCalendarProps {
  departamento: string;
  codigoPostal: string;
  productIds: string[];
  value: string;
  onChange: (fecha: string) => void;
  whatsappUrl: string;
  error?: string;
}

type Estado = "cargando" | "error" | "vacio" | "listo";

export function FechaDisponibleCalendar({
  departamento,
  codigoPostal,
  productIds,
  value,
  onChange,
  whatsappUrl,
  error,
}: FechaDisponibleCalendarProps) {
  const [fechas, setFechas] = useState<Set<string>>(new Set());
  const [estado, setEstado] = useState<Estado>("cargando");
  const [visibleMonth, setVisibleMonth] = useState<MesVisible | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const productIdsKey = productIds.join(",");

  useEffect(() => {
    let cancelado = false;
    setEstado("cargando");

    getFechasDisponibles(departamento, codigoPostal, productIds)
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
  }, [departamento, codigoPostal, productIdsKey, retryToken]);

  if (estado === "cargando") {
    return <p className="hint">Buscando fechas disponibles...</p>;
  }

  if (estado === "error") {
    return (
      <div className="calendar-error">
        <p className="field-error">No pudimos cargar las fechas disponibles.</p>
        <button type="button" className="btn-link" onClick={() => setRetryToken((n) => n + 1)}>
          Reintentar
        </button>
      </div>
    );
  }

  if (estado === "vacio") {
    return (
      <div className="calendar-empty">
        <p>No tenemos fechas disponibles por el momento.</p>
        <a className="btn-secondary" href={whatsappUrl} target="_blank" rel="noopener noreferrer">
          Escríbenos por WhatsApp
        </a>
      </div>
    );
  }

  if (!visibleMonth) return null;

  const fechasOrdenadas = [...fechas].sort();
  const primeraFecha = new Date(`${fechasOrdenadas[0]}T00:00:00Z`);
  const ultimaFecha = new Date(`${fechasOrdenadas[fechasOrdenadas.length - 1]}T00:00:00Z`);
  const minMes: MesVisible = { year: primeraFecha.getUTCFullYear(), month: primeraFecha.getUTCMonth() };
  const maxMes: MesVisible = { year: ultimaFecha.getUTCFullYear(), month: ultimaFecha.getUTCMonth() };

  const puedeRetroceder =
    visibleMonth.year > minMes.year || (visibleMonth.year === minMes.year && visibleMonth.month > minMes.month);
  const puedeAvanzar =
    visibleMonth.year < maxMes.year || (visibleMonth.year === maxMes.year && visibleMonth.month < maxMes.month);

  const celdas = buildMonthGrid(visibleMonth.year, visibleMonth.month);

  return (
    <div className="calendar">
      <div className="calendar__header">
        <button
          type="button"
          className="calendar__nav"
          disabled={!puedeRetroceder}
          onClick={() => setVisibleMonth((m) => (m ? { year: m.month === 0 ? m.year - 1 : m.year, month: (m.month + 11) % 12 } : m))}
          aria-label="Mes anterior"
        >
          ‹
        </button>
        <span className="calendar__month-label">
          {MESES[visibleMonth.month]} {visibleMonth.year}
        </span>
        <button
          type="button"
          className="calendar__nav"
          disabled={!puedeAvanzar}
          onClick={() => setVisibleMonth((m) => (m ? { year: m.month === 11 ? m.year + 1 : m.year, month: (m.month + 1) % 12 } : m))}
          aria-label="Mes siguiente"
        >
          ›
        </button>
      </div>
      <div className="calendar__weekdays">
        {DIAS_SEMANA.map((d, i) => (
          <span key={`${d}-${i}`}>{d}</span>
        ))}
      </div>
      <div className="calendar__grid">
        {celdas.map((cell) => {
          const disponible = cell.inMonth && fechas.has(cell.iso);
          const seleccionada = cell.iso === value;
          return (
            <button
              type="button"
              key={cell.iso}
              disabled={!disponible}
              className={`calendar__day${seleccionada ? " is-selected" : ""}${!cell.inMonth ? " is-outside" : ""}`}
              onClick={() => onChange(cell.iso)}
            >
              {Number(cell.iso.slice(8, 10))}
            </button>
          );
        })}
      </div>
      <FieldError message={error} />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck --workspace=packages/frontend`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/FechaDisponibleCalendar.tsx
git commit -m "Agregar componente de calendario con fechas disponibles"
```

---

### Task 6: Integrar el calendario en el paso 4 + estilos

**Files:**
- Modify: `packages/frontend/src/App.tsx`
- Modify: `packages/frontend/src/styles.css`

**Interfaces:**
- Consumes: `FechaDisponibleCalendar` de Task 5, `WHATSAPP_URL` (ya existe en `App.tsx`, linea 123).

- [ ] **Step 1: Reemplazar el input de fecha por el calendario**

Edita `packages/frontend/src/App.tsx`. Agrega el import al inicio del archivo, junto a los demas imports de componentes:

```ts
import { FechaDisponibleCalendar } from "./FechaDisponibleCalendar.js";
```

Busca este bloque (dentro del fieldset del paso 4, "Fecha de visita"):

```tsx
            <div className="field">
              <label htmlFor="fechaVisita">Fecha deseada</label>
              <input
                id="fechaVisita"
                type="date"
                value={form.fechaVisita}
                onChange={(e) => update("fechaVisita", e.target.value)}
              />
              <FieldError message={fieldErrors.fechaVisita} />
              <p className="hint">Fecha tentativa, sujeta a disponibilidad de cupos.</p>
            </div>
```

Y reemplazalo por:

```tsx
            <div className="field">
              <label>Fecha deseada</label>
              <FechaDisponibleCalendar
                departamento={form.departamento}
                codigoPostal={form.codigoPostal}
                productIds={form.productos.map((p) => p.productId).filter(Boolean)}
                value={form.fechaVisita}
                onChange={(fecha) => update("fechaVisita", fecha)}
                whatsappUrl={WHATSAPP_URL}
                error={fieldErrors.fechaVisita}
              />
              <p className="hint">Fecha tentativa, sujeta a disponibilidad de cupos.</p>
            </div>
```

- [ ] **Step 2: Agregar los estilos del calendario**

Edita `packages/frontend/src/styles.css` y agrega al final del archivo:

```css
.calendar {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  padding: 0.9rem;
  background: var(--bg-sunken);
}

.calendar__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.6rem;
}

.calendar__month-label {
  font-weight: 900;
  font-size: 0.9rem;
  text-transform: capitalize;
}

.calendar__nav {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1px solid var(--color-border);
  background: #ffffff;
  color: var(--color-primary);
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
  padding: 0;
}

.calendar__nav:disabled {
  color: var(--color-text-muted);
  border-color: var(--color-border);
  cursor: not-allowed;
  opacity: 0.5;
}

.calendar__weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
  margin-bottom: 2px;
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--color-text-muted);
  text-align: center;
}

.calendar__grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}

.calendar__day {
  aspect-ratio: 1;
  border: none;
  border-radius: 6px;
  background: #ffffff;
  color: var(--color-text);
  font-size: 0.82rem;
  cursor: pointer;
  padding: 0;
}

.calendar__day:hover:not(:disabled) {
  background: rgba(76, 95, 128, 0.15);
}

.calendar__day.is-selected {
  background: var(--color-primary);
  color: #ffffff;
  font-weight: 900;
}

.calendar__day:disabled {
  background: transparent;
  color: var(--color-text-muted);
  cursor: not-allowed;
  opacity: 0.4;
}

.calendar__day.is-outside {
  visibility: hidden;
}

.calendar-error,
.calendar-empty {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  padding: 1rem;
  background: var(--bg-sunken);
  text-align: center;
}

.calendar-empty p {
  margin: 0 0 0.8rem;
  font-size: 0.9rem;
}

.calendar-empty .btn-secondary {
  display: inline-block;
  width: auto;
  margin-top: 0;
  text-decoration: none;
  padding: 0.6rem 1.2rem;
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck --workspace=packages/frontend`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/App.tsx packages/frontend/src/styles.css
git commit -m "Reemplazar el input de fecha por el calendario de disponibilidad"
```

---

### Task 7: Verificacion completa y manual en el navegador

**Files:** ninguno nuevo - solo verificacion.

- [ ] **Step 1: Typecheck y tests de todo el monorepo**

Run: `npm run typecheck --workspaces --if-present`
Expected: sin errores en los 4 paquetes.

Run: `npm test --workspaces --if-present`
Expected: todos los tests pasan (backend: 38 anteriores + 2 nuevos de app.test + 6 nuevos de cuposEngine = 46; c4c-client: 6; shared: 22 - sin cambios).

- [ ] **Step 2: Verificacion manual en el navegador (dev server)**

Iniciar el dev server del frontend (`packages/frontend`, comando `npm run dev` o el preview del proyecto) y en el navegador:

1. Llenar pasos 1-3 del formulario con datos validos (direccion con departamento/codigoPostal, y al menos un producto con productId real).
2. Llegar al paso 4 y confirmar que aparece "Buscando fechas disponibles..." brevemente y luego el calendario (o el aviso de "sin fechas" si C4C QA sigue sin cupos futuros cargados - ver la nota de riesgo operativo en el spec).
3. Si aparece el calendario: confirmar que los dias fuera de la lista de disponibles estan deshabilitados (no se pueden clickear) y los disponibles si.
4. Click en una fecha disponible: confirmar que queda visualmente seleccionada y que `form.fechaVisita` se actualiza (se puede verificar leyendo el value del campo via las devtools, o confirmando que el envio del formulario mas adelante usa esa fecha).
5. Si aparece el aviso de "sin fechas disponibles": confirmar que el boton de WhatsApp tiene el href correcto (`https://api.whatsapp.com/send/?phone=5116190500&text&type=phone_number&app_absent=0`).
6. Retroceder al paso 2, cambiar la direccion, avanzar de nuevo al paso 4: confirmar que se vuelve a consultar (nuevo "Buscando fechas disponibles...").
7. Confirmar que no hay errores en la consola del navegador.

- [ ] **Step 3: Confirmar que no se rompio el envio real del formulario**

Con una fecha disponible seleccionada (o, si no hay ninguna disponible en QA, verificar solo hasta el paso anterior sin enviar), completar el resto del formulario y enviar. Confirmar que la solicitud sigue funcionando igual que antes (el motor de cupos real `assignCupo` sigue validando al enviar, sin cambios de comportamiento ahi).

---

## Notas para quien ejecute este plan

- La dependencia operativa mencionada en el spec (C4C QA sin cupos cargados mas alla del 2026-07-11) significa que la verificacion manual del Task 7 probablemente muestre el estado "sin fechas disponibles" hasta que el equipo de C4C cargue cupos futuros - eso es el comportamiento correcto, no un bug del calendario.
- Ningun cambio de este plan toca `assignCupo`, `runServiceRequestOrchestration`, ni la logica de reserva real - son estrictamente aditivos.
