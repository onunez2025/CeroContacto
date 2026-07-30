# Buscador de código postal contra cobertura real de SOLE - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el campo de texto libre "Código postal" del paso 2 (Dirección) por un buscador tipo autocompletar contra `cust/v1/regionxdepartamento` — la tabla real de zonas de cobertura de servicio de SOLE que valida C4C al crear un ticket — para eliminar el error "no se encontró una región activa para el código postal ingresado" causado por códigos escritos a mano sin relación con la cobertura real.

**Architecture:** Nuevo módulo de dominio de solo lectura (`postalCodeLookup`, mismo patrón que `productCatalog`) expuesto vía dos endpoints nuevos (`GET /api/codigos-postales` y `GET /api/codigos-postales/cobertura`). El frontend consulta la cobertura del departamento elegido una sola vez, y si hay cobertura, muestra un buscador (mismo patrón visual que `ProductoPicker`) para elegir el código postal real.

**Tech Stack:** Node.js/Express/TypeScript (backend), React/TypeScript (frontend), Vitest + Supertest (tests), SAP C4C OData v1 (`cust/v1/regionxdepartamento`, BO `BO_RegionRoot`).

## Global Constraints

- `regionxdepartamento` NO es un catálogo genérico de UBIGEO de Perú — es la tabla de zonas de cobertura de servicio de SOLE (`zRegRegin` con valores como `"SOLE-LIMA"`). Solo los registros con `zRegactivo = true` son válidos para mostrar/seleccionar.
- Filtrar siempre por el departamento ya elegido por el cliente (`zRegDepart eq '<departamento>'`) — nunca búsqueda nacional abierta.
- Dos niveles de "sin resultados", no confundir: **sin cobertura en todo el departamento** (aviso fuerte + WhatsApp, bloquea) vs. **sin resultados para una búsqueda puntual** (mensaje suave, invita a seguir intentando).
- Usar el cliente de catálogo de solo lectura ya existente (`buildProductCatalogClientFromEnv`, producción) — nunca el cliente transaccional.
- No modificar `PERU_DISTRITOS`/`PERU_PROVINCIAS`/`PERU_DEPARTAMENTOS` ni los campos `distrito`/`provincia` del ticket — esquema de códigos independiente.

---

### Task 1: Módulo de dominio `postalCodeLookup` (TDD)

**Files:**
- Create: `packages/backend/src/domain/postalCodeLookup/types.ts`
- Create: `packages/backend/src/domain/postalCodeLookup/index.ts`
- Test: `packages/backend/src/domain/postalCodeLookup/postalCodeLookup.test.ts`

**Interfaces:**
- Consumes: `IC4CODataClient` (`getCollection<T>(path): Promise<T[]>`) de `@cerocontacto/c4c-client`.
- Produces: `searchPostalCodes(departamento: string, query: string, client: IC4CODataClient): Promise<PostalCodeMatch[]>`, `hasActiveCoverage(departamento: string, client: IC4CODataClient): Promise<boolean>`, tipo `PostalCodeMatch` (usados por Task 2, el endpoint).

- [ ] **Step 1: Crear el tipo**

`packages/backend/src/domain/postalCodeLookup/types.ts`:

```ts
export interface PostalCodeMatch {
  distrito: string;
  codigoPostal: string;
}
```

- [ ] **Step 2: Escribir los tests que fallan**

`packages/backend/src/domain/postalCodeLookup/postalCodeLookup.test.ts`:

```ts
import type { IC4CODataClient } from "@cerocontacto/c4c-client";
import { describe, expect, it, vi } from "vitest";
import { hasActiveCoverage, searchPostalCodes } from "./index.js";

function clientReturning(items: Array<{ zIDDistrito: string; zPostalCodigo: string }>): IC4CODataClient {
  return {
    getCollection: vi.fn().mockResolvedValue(items) as unknown as IC4CODataClient["getCollection"],
    postEntity: vi.fn(),
    patch: vi.fn(),
  };
}

describe("searchPostalCodes", () => {
  it("devuelve [] si no hay departamento", async () => {
    const client = clientReturning([{ zIDDistrito: "SAN BORJA", zPostalCodigo: "15130" }]);
    const result = await searchPostalCodes("", "san borja", client);
    expect(result).toEqual([]);
    expect(client.getCollection).not.toHaveBeenCalled();
  });

  it("devuelve [] si la busqueda tiene menos de 2 caracteres", async () => {
    const client = clientReturning([{ zIDDistrito: "SAN BORJA", zPostalCodigo: "15130" }]);
    const result = await searchPostalCodes("15", "s", client);
    expect(result).toEqual([]);
    expect(client.getCollection).not.toHaveBeenCalled();
  });

  it("mapea zIDDistrito/zPostalCodigo a distrito/codigoPostal y filtra por departamento + activo + nombre", async () => {
    const client = clientReturning([
      { zIDDistrito: "San Juan de Lurigancho", zPostalCodigo: "15453" },
      { zIDDistrito: "Lurigancho, San Juan de Lurigancho", zPostalCodigo: "15457" },
    ]);

    const result = await searchPostalCodes("15", "lurigancho", client);

    expect(result).toEqual([
      { distrito: "San Juan de Lurigancho", codigoPostal: "15453" },
      { distrito: "Lurigancho, San Juan de Lurigancho", codigoPostal: "15457" },
    ]);
    const [path] = (client.getCollection as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(path).toContain("zRegDepart%20eq%20'15'");
    expect(path).toContain("zRegactivo%20eq%20true");
    expect(path).toContain("substringof('LURIGANCHO',zIDDistrito)".replace(/[()',]/g, (c) => encodeURIComponent(c)));
  });
});

describe("hasActiveCoverage", () => {
  it("devuelve false si no hay departamento, sin llamar a C4C", async () => {
    const client = clientReturning([]);
    const result = await hasActiveCoverage("", client);
    expect(result).toBe(false);
    expect(client.getCollection).not.toHaveBeenCalled();
  });

  it("devuelve true si hay al menos un registro activo", async () => {
    const client = clientReturning([{ zIDDistrito: "SAN BORJA", zPostalCodigo: "15130" }]);
    const result = await hasActiveCoverage("15", client);
    expect(result).toBe(true);
  });

  it("devuelve false si no hay ningun registro activo en el departamento", async () => {
    const client = clientReturning([]);
    const result = await hasActiveCoverage("99", client);
    expect(result).toBe(false);
  });
});
```

- [ ] **Step 3: Correr los tests para verificar que fallan**

Run: `npm test --workspace=packages/backend -- postalCodeLookup`
Expected: FAIL — `Cannot find module './index.js'`.

- [ ] **Step 4: Implementar `searchPostalCodes` y `hasActiveCoverage`**

`packages/backend/src/domain/postalCodeLookup/index.ts`:

```ts
import type { IC4CODataClient } from "@cerocontacto/c4c-client";
import type { PostalCodeMatch } from "./types.js";

export * from "./types.js";

const NS = "cust/v1/regionxdepartamento";

function escapeODataString(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Busca zonas de cobertura de servicio ACTIVAS de SOLE por coincidencia
 * parcial de nombre de distrito/zona, dentro de un departamento.
 * regionxdepartamento NO es un catalogo generico de UBIGEO de Peru - es
 * la misma tabla que usa C4C para la regla de negocio "region activa
 * para el codigo postal" al crear un ticket (confirmado en vivo contra
 * produccion, 2026-07-30).
 */
export async function searchPostalCodes(
  departamento: string,
  query: string,
  client: IC4CODataClient,
): Promise<PostalCodeMatch[]> {
  const trimmed = query.trim();
  if (!departamento || trimmed.length < 2) return [];

  const filter = [
    `zRegDepart eq '${escapeODataString(departamento)}'`,
    `zRegactivo eq true`,
    `substringof('${escapeODataString(trimmed.toUpperCase())}',zIDDistrito)`,
  ].join(" and ");

  const results = await client.getCollection<{ zIDDistrito: string; zPostalCodigo: string }>(
    `${NS}/BO_RegionRootCollection?$filter=${encodeURIComponent(filter)}&$top=20&$select=zIDDistrito,zPostalCodigo`,
  );

  return results.map((r) => ({ distrito: r.zIDDistrito, codigoPostal: r.zPostalCodigo }));
}

/** true si el departamento tiene al menos una zona de cobertura activa (sin depender de texto de busqueda). */
export async function hasActiveCoverage(departamento: string, client: IC4CODataClient): Promise<boolean> {
  if (!departamento) return false;

  const filter = [`zRegDepart eq '${escapeODataString(departamento)}'`, `zRegactivo eq true`].join(" and ");

  const results = await client.getCollection<{ zIDDistrito: string }>(
    `${NS}/BO_RegionRootCollection?$filter=${encodeURIComponent(filter)}&$top=1&$select=zIDDistrito`,
  );

  return results.length > 0;
}
```

- [ ] **Step 5: Correr los tests para verificar que pasan**

Run: `npm test --workspace=packages/backend -- postalCodeLookup`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/domain/postalCodeLookup/types.ts packages/backend/src/domain/postalCodeLookup/index.ts packages/backend/src/domain/postalCodeLookup/postalCodeLookup.test.ts
git commit -m "Agregar busqueda de codigos postales contra cobertura real de SOLE (regionxdepartamento)"
```

---

### Task 2: Endpoints `GET /api/codigos-postales` y `GET /api/codigos-postales/cobertura`

**Files:**
- Modify: `packages/backend/src/app.ts`
- Modify: `packages/backend/src/app.test.ts`

**Interfaces:**
- Consumes: `searchPostalCodes`, `hasActiveCoverage` de `./domain/postalCodeLookup/index.js` (Task 1); `buildProductCatalogClientFromEnv` de `./config.js` (ya existe).
- Produces: rutas `GET /api/codigos-postales?departamento=...&q=...` y `GET /api/codigos-postales/cobertura?departamento=...` (usadas por Task 3, el cliente del frontend).

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `packages/backend/src/app.test.ts`, junto a los `vi.hoisted`/`vi.mock` existentes (antes de `import { createApp } from "./app.js";`):

```ts
const { mockSearchPostalCodes, mockHasActiveCoverage } = vi.hoisted(() => ({
  mockSearchPostalCodes: vi.fn(),
  mockHasActiveCoverage: vi.fn(),
}));

vi.mock("./domain/postalCodeLookup/index.js", () => ({
  searchPostalCodes: mockSearchPostalCodes,
  hasActiveCoverage: mockHasActiveCoverage,
}));
```

Agregar `mockSearchPostalCodes.mockReset(); mockHasActiveCoverage.mockReset();` al `afterEach` existente.

Agregar estos tests dentro del `describe("createApp", ...)`, junto a los de `/api/productos`:

```ts
it("GET /api/codigos-postales devuelve los resultados de la busqueda", async () => {
  mockSearchPostalCodes.mockResolvedValue([{ distrito: "SAN BORJA", codigoPostal: "15130" }]);

  const res = await request(createApp()).get("/api/codigos-postales?departamento=15&q=san+borja");

  expect(res.status).toBe(200);
  expect(res.body).toEqual({ resultados: [{ distrito: "SAN BORJA", codigoPostal: "15130" }] });
});

it("GET /api/codigos-postales sin parametros devuelve resultados vacios sin llamar a C4C", async () => {
  const res = await request(createApp()).get("/api/codigos-postales");

  expect(res.status).toBe(200);
  expect(res.body).toEqual({ resultados: [] });
  expect(mockSearchPostalCodes).not.toHaveBeenCalled();
});

it("GET /api/codigos-postales/cobertura devuelve tieneCobertura", async () => {
  mockHasActiveCoverage.mockResolvedValue(true);

  const res = await request(createApp()).get("/api/codigos-postales/cobertura?departamento=15");

  expect(res.status).toBe(200);
  expect(res.body).toEqual({ tieneCobertura: true });
});

it("GET /api/codigos-postales/cobertura sin departamento devuelve false sin llamar a C4C", async () => {
  const res = await request(createApp()).get("/api/codigos-postales/cobertura");

  expect(res.status).toBe(200);
  expect(res.body).toEqual({ tieneCobertura: false });
  expect(mockHasActiveCoverage).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `npm test --workspace=packages/backend -- app.test`
Expected: FAIL — 404 en las 4 rutas nuevas.

- [ ] **Step 3: Agregar las rutas en `app.ts`**

Agregar el import (junto a los existentes, línea 4):

```ts
import { hasActiveCoverage, searchPostalCodes } from "./domain/postalCodeLookup/index.js";
```

Dentro de `createApp()`, después del bloque de `/api/fechas-disponibles` y antes de `const customerLookupRateLimiter = ...`, agregar:

```ts
  app.get("/api/codigos-postales", async (req, res) => {
    const departamento = typeof req.query.departamento === "string" ? req.query.departamento : "";
    const q = typeof req.query.q === "string" ? req.query.q : "";

    if (!departamento || !q) {
      res.status(200).json({ resultados: [] });
      return;
    }

    try {
      const client = buildProductCatalogClientFromEnv();
      const resultados = await searchPostalCodes(departamento, q, client);
      res.status(200).json({ resultados });
    } catch (err) {
      console.error("codigos_postales_search_failed", err);
      res.status(502).json({ error: "No pudimos buscar codigos postales en este momento." });
    }
  });

  app.get("/api/codigos-postales/cobertura", async (req, res) => {
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
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `npm test --workspace=packages/backend -- app.test`
Expected: PASS (todos los tests de `app.test.ts`, incluidos los 4 nuevos).

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/app.ts packages/backend/src/app.test.ts
git commit -m "Agregar endpoints GET /api/codigos-postales y /api/codigos-postales/cobertura"
```

---

### Task 3: Cliente del frontend (`api.ts`)

**Files:**
- Modify: `packages/frontend/src/api.ts`

**Interfaces:**
- Produces: `searchPostalCodes(departamento: string, query: string): Promise<PostalCodeMatch[]>`, `hasActiveCoverage(departamento: string): Promise<boolean>`, tipo `PostalCodeMatch` (usados por Task 4).

No hay suite de tests de frontend en este proyecto — este paso no lleva TDD, sigue el mismo patrón que `searchProducts` ya existente en el mismo archivo.

- [ ] **Step 1: Agregar los tipos y las funciones, al final del archivo**

```ts
export interface PostalCodeMatch {
  distrito: string;
  codigoPostal: string;
}

/** Busca codigos postales (zonas de cobertura activas de SOLE) por nombre de distrito/zona, dentro de un departamento. */
export async function searchPostalCodes(departamento: string, query: string): Promise<PostalCodeMatch[]> {
  const params = new URLSearchParams({ departamento, q: query });
  const res = await fetch(`/api/codigos-postales?${params.toString()}`);
  const body = (await res.json().catch(() => undefined)) as
    | { resultados?: PostalCodeMatch[]; error?: string }
    | undefined;
  if (!res.ok) {
    throw new ApiError(body?.error ?? "No pudimos buscar codigos postales. Intenta de nuevo.");
  }
  return body?.resultados ?? [];
}

/** true si el departamento tiene al menos una zona de cobertura de servicio activa. */
export async function hasActiveCoverage(departamento: string): Promise<boolean> {
  const params = new URLSearchParams({ departamento });
  const res = await fetch(`/api/codigos-postales/cobertura?${params.toString()}`);
  if (!res.ok) return false;
  const body = (await res.json().catch(() => undefined)) as { tieneCobertura?: boolean } | undefined;
  return body?.tieneCobertura ?? false;
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npm run typecheck --workspace=packages/frontend`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/api.ts
git commit -m "Agregar cliente de busqueda de codigos postales al frontend"
```

---

### Task 4: Buscador de código postal en `App.tsx`

**Files:**
- Modify: `packages/frontend/src/App.tsx`

**Interfaces:**
- Consumes: `searchPostalCodes`, `hasActiveCoverage`, `PostalCodeMatch` de `./api.js` (Task 3); `WHATSAPP_URL` (constante ya existente en el mismo archivo, usada por `HeroPanel`).

- [ ] **Step 1: Ampliar el import de `./api.js`**

Reemplazar la línea 5 actual:

```ts
import { ApiError, lookupCustomer, submitServiceRequest, type SubmitResult } from "./api.js";
```

por:

```ts
import {
  ApiError,
  hasActiveCoverage,
  lookupCustomer,
  searchPostalCodes,
  submitServiceRequest,
  type PostalCodeMatch,
  type SubmitResult,
} from "./api.js";
```

- [ ] **Step 2: Agregar estado y handlers dentro de `App()`**

Después del bloque de `handleDocumentoChange` (agregado por la feature de autocompletado de cliente, justo antes de `async function handleSubmit`), agregar:

```ts
  const [coverageStatus, setCoverageStatus] = useState<"idle" | "checking" | "covered" | "not-covered">("idle");
  const [postalQuery, setPostalQuery] = useState("");
  const [postalResults, setPostalResults] = useState<PostalCodeMatch[]>([]);
  const [postalOpen, setPostalOpen] = useState(false);
  const [postalLoading, setPostalLoading] = useState(false);
  const [postalSearchError, setPostalSearchError] = useState<string | null>(null);
  const postalDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (form.codigoPostal && !postalQuery) {
      setPostalQuery(form.codigoPostal);
    }
  }, [form.codigoPostal]);

  useEffect(() => {
    if (!form.departamento) {
      setCoverageStatus("idle");
      return;
    }
    let cancelled = false;
    setCoverageStatus("checking");
    hasActiveCoverage(form.departamento).then((covered) => {
      if (!cancelled) setCoverageStatus(covered ? "covered" : "not-covered");
    });
    return () => {
      cancelled = true;
    };
  }, [form.departamento]);

  function handleDepartamentoChange(value: string) {
    setForm((prev) => ({ ...prev, departamento: value, provincia: "", distrito: "", codigoPostal: "" }));
    setPostalQuery("");
    setPostalResults([]);
    setPostalOpen(false);
  }

  function handlePostalQueryChange(value: string) {
    setPostalQuery(value);
    if (form.codigoPostal) update("codigoPostal", "");
    if (postalDebounceRef.current) clearTimeout(postalDebounceRef.current);

    if (value.trim().length < 2) {
      setPostalResults([]);
      setPostalSearchError(null);
      setPostalOpen(false);
      return;
    }

    postalDebounceRef.current = setTimeout(() => {
      setPostalLoading(true);
      setPostalSearchError(null);
      setPostalOpen(true);
      searchPostalCodes(form.departamento, value)
        .then((items) => {
          setPostalResults(items);
        })
        .catch((err: unknown) => {
          setPostalSearchError(
            err instanceof ApiError ? err.message : "No pudimos buscar codigos postales. Intenta de nuevo.",
          );
          setPostalResults([]);
        })
        .finally(() => setPostalLoading(false));
    }, 300);
  }

  function selectPostalMatch(item: PostalCodeMatch) {
    update("codigoPostal", item.codigoPostal);
    setPostalQuery(`${item.distrito} — ${item.codigoPostal}`);
    setPostalResults([]);
    setPostalOpen(false);
  }
```

- [ ] **Step 3: Conectar el select de Departamento al nuevo handler**

Reemplazar (dentro del bloque `step === 2`, campo Departamento):

```tsx
              <select
                id="departamento"
                value={form.departamento}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, departamento: e.target.value, provincia: "", distrito: "" }))
                }
              >
```

por:

```tsx
              <select id="departamento" value={form.departamento} onChange={(e) => handleDepartamentoChange(e.target.value)}>
```

- [ ] **Step 4: Reemplazar el campo de código postal**

Reemplazar el bloque completo del campo "Código postal" (el `<div className="field">` que contiene `htmlFor="codigoPostal"`):

```tsx
              <div className="field">
                <label htmlFor="codigoPostal">Código postal</label>
                <input
                  id="codigoPostal"
                  type="text"
                  value={form.codigoPostal}
                  onChange={(e) => update("codigoPostal", e.target.value)}
                />
                <FieldError message={fieldErrors["direccion.codigoPostal"]} />
              </div>
```

por:

```tsx
              <div className="field">
                <label htmlFor="codigoPostal">Código postal</label>
                {coverageStatus === "not-covered" ? (
                  <p className="hint">
                    No tenemos cobertura en tu zona todavía.{" "}
                    <a href={WHATSAPP_URL} target="_blank" rel="noreferrer">
                      Escríbenos por WhatsApp
                    </a>{" "}
                    para coordinar manualmente.
                  </p>
                ) : (
                  <div className="autocomplete">
                    <input
                      id="codigoPostal"
                      type="text"
                      autoComplete="off"
                      placeholder={form.departamento ? "Escribe tu distrito o zona..." : "Primero elige un departamento"}
                      disabled={!form.departamento || coverageStatus !== "covered"}
                      value={postalQuery}
                      onChange={(e) => handlePostalQueryChange(e.target.value)}
                      onFocus={() => postalResults.length > 0 && setPostalOpen(true)}
                      onBlur={() => setTimeout(() => setPostalOpen(false), 150)}
                    />
                    {form.codigoPostal ? (
                      <span className="autocomplete-check" aria-hidden="true">
                        ✓
                      </span>
                    ) : null}
                    {postalOpen ? (
                      <ul className="autocomplete-list">
                        {postalLoading ? (
                          <li className="autocomplete-loading">Buscando...</li>
                        ) : postalSearchError ? (
                          <li className="autocomplete-loading autocomplete-error">{postalSearchError}</li>
                        ) : postalResults.length === 0 ? (
                          <li className="autocomplete-loading">Sin resultados para "{postalQuery}", intenta con otro nombre</li>
                        ) : (
                          postalResults.map((item) => (
                            <li key={`${item.distrito}-${item.codigoPostal}`}>
                              <button
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => selectPostalMatch(item)}
                              >
                                {item.distrito} — {item.codigoPostal}
                              </button>
                            </li>
                          ))
                        )}
                      </ul>
                    ) : null}
                  </div>
                )}
                <FieldError message={fieldErrors["direccion.codigoPostal"]} />
              </div>
```

- [ ] **Step 5: Verificar que compila**

Run: `npm run typecheck --workspace=packages/frontend`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/App.tsx
git commit -m "Reemplazar codigo postal de texto libre por buscador contra cobertura real de SOLE"
```

---

### Task 5: Verificación completa

**Files:** ninguno (solo verificación).

- [ ] **Step 1: Typecheck de todo el monorepo**

Run: `npm run typecheck --workspaces`
Expected: sin errores en `shared`, `c4c-client`, `backend`, `frontend`.

- [ ] **Step 2: Tests de todo el monorepo**

Run: `npm test --workspaces`
Expected: todos los tests pasan (los existentes + los ~10 nuevos de `postalCodeLookup.test.ts` y `app.test.ts`).

- [ ] **Step 3: Identificar un departamento sin cobertura activa, para probar el aviso fuerte**

Con las credenciales de `.env.local` (`C4C_CATALOG_*`), correr contra producción real (solo lectura):

```bash
curl -s -u "oscar.nunez:REDACTED_ROTATE_THIS_PASSWORD" "https://my361897.crm.ondemand.com/sap/c4c/odata/cust/v1/regionxdepartamento/BO_RegionRootCollection/\$count?\$filter=zRegDepart%20eq%20'01'%20and%20zRegactivo%20eq%20true" --max-time 20
```

(Probar con distintos códigos de `PERU_DEPARTAMENTOS` hasta encontrar uno que devuelva `0` — ese es el departamento a usar en el Step 6 para probar el estado "sin cobertura". Si todos tienen algo de cobertura, usar el que tenga el número más bajo para acercarse al caso límite.)

- [ ] **Step 4: Build y arranque local del backend**

```bash
npm run build --workspace=packages/shared
npm run build --workspace=packages/c4c-client
npm run build --workspace=packages/backend
node packages/backend/dist/server.js
```
Expected: arranca sin errores, usando `.env.local` (credenciales de producción ya configuradas).

- [ ] **Step 5: Verificación manual en el navegador — departamento CON cobertura (Lima)**

Con el backend local corriendo y el frontend en modo dev, ir al paso 2, elegir Departamento = Lima, escribir en el nuevo campo (ej. "san borja") y confirmar: aparece "Buscando...", luego una lista con resultados tipo "SAN BORJA — 15130", seleccionar uno rellena el código postal y muestra el check ✓.

- [ ] **Step 6: Verificación manual en el navegador — departamento SIN cobertura**

Elegir el departamento identificado en el Step 3 (sin cobertura activa) y confirmar: el campo de búsqueda se oculta, aparece el aviso "No tenemos cobertura en tu zona todavía" con el enlace de WhatsApp.

- [ ] **Step 7: Verificación manual — búsqueda sin resultados puntual**

Con un departamento CON cobertura, escribir algo que no matchee ningún distrito (ej. "zzzzz") y confirmar: aparece el mensaje suave "Sin resultados para 'zzzzz', intenta con otro nombre" — no el aviso fuerte de WhatsApp.

- [ ] **Step 8: Verificación manual — cambio de departamento limpia la selección**

Seleccionar un código postal, luego cambiar el Departamento y confirmar que el campo de búsqueda se vacía y hay que volver a elegir.

- [ ] **Step 9: Confirmar con el usuario y hacer push**

Mostrar el resultado de la verificación al usuario. Si todo está bien, preguntar si quiere hacer `git push origin master`.
