# Autocompletado de datos cuando el cliente ya existe en C4C - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cuando el cliente ya existe en C4C (por DNI/CE/RUC), autocompletar sus datos personales y dirección en el formulario apenas escribe su número de documento, sin crear clientes nuevos ni bloquear el resto del flujo.

**Architecture:** Nueva función de dominio de solo lectura (`customerLookup`, separada de `customerResolution` que sí crea clientes) expuesta vía `GET /api/clientes/lookup`, protegida con un rate-limiter propio en memoria. El frontend la llama en el evento `blur` del campo "Número de documento" y autocompleta campos editables del formulario.

**Tech Stack:** Node.js/Express/TypeScript (backend), React/TypeScript (frontend), Vitest + Supertest (tests), zod (validación), SAP C4C OData v1 (`v1/c4codataapi`).

## Global Constraints

- No agregar `express-rate-limit` ni ninguna dependencia nueva — el rate limiter es una función propia de ~20 líneas.
- Rate limit: 10 solicitudes/minuto por IP, solo en `GET /api/clientes/lookup`.
- Cobertura: DNI, CE y RUC (personas y empresas).
- Campos autocompletados quedan **editables**, nunca de solo lectura.
- El endpoint nunca crea clientes en C4C — es 100% lectura.
- `found: false` o error de red nunca bloquea ni muestra error al usuario — falla en silencio (con `console.error` para debugging).
- Seguir el patrón existente de dos consultas secuenciales a C4C (no usar `$expand`, no probado en este proyecto).

---

### Task 1: Tipos + `lookupIndividual` (DNI/CE), TDD

**Files:**
- Create: `packages/backend/src/domain/customerLookup/types.ts`
- Create: `packages/backend/src/domain/customerLookup/address.ts`
- Create: `packages/backend/src/domain/customerLookup/individual.ts`
- Test: `packages/backend/src/domain/customerLookup/customerLookup.test.ts`

**Interfaces:**
- Consumes: `IC4CODataClient` (`getCollection<T>(path): Promise<T[]>`, `postEntity`, `patch`) de `@cerocontacto/c4c-client`; `and`/`eq` de `@cerocontacto/c4c-client`; `Address` de `@cerocontacto/shared`; `INDIVIDUAL_TAX_TYPE_CODE` de `../customerResolution/types.js` (`{ DNI: "2", CE: "5" }`).
- Produces: `lookupIndividual(tipoDocumento: "DNI" | "CE", numeroDocumento: string, client: IC4CODataClient): Promise<CustomerLookupResult>`, tipo `CustomerLookupResult`, tipo `CustomerLookupData`, helper `buildDireccion(address: AddressSubRecord | undefined): Partial<Address>` (usado también por Task 2).

- [ ] **Step 1: Crear los tipos**

`packages/backend/src/domain/customerLookup/types.ts`:

```ts
import { z } from "zod";
import type { Address } from "@cerocontacto/shared";

export interface CustomerLookupData {
  nombres?: string;
  apellidos?: string;
  razonSocial?: string;
  telefono: string;
  email: string;
  direccion: Partial<Address>;
}

export interface CustomerLookupResult {
  found: boolean;
  datos?: CustomerLookupData;
}

/** Fila de IndividualCustomerTaxNumberCollection / CorporateAccountTaxNumberCollection. */
export interface TaxNumberLookupRecord {
  ParentObjectID: string;
  CustomerID?: string;
  AccountID?: string;
}

/** Campos leidos de IndividualCustomerCollection para autocompletar. */
export interface IndividualCustomerLookupRecord {
  ObjectID: string;
  CustomerID: string;
  FirstName?: string;
  LastName?: string;
  Phone?: string;
  Email?: string;
}

/** Campos leidos de CorporateAccountCollection para autocompletar. */
export interface CorporateAccountLookupRecord {
  ObjectID: string;
  AccountID: string;
  Name?: string;
  Phone?: string;
  Email?: string;
}

/** Fila de IndividualCustomerAddress / CorporateAccountAddress (misma forma en ambas). */
export interface AddressSubRecord {
  StateCode?: string;
  zIDProvinciacontent_SDK?: string;
  zIDDistritocontent_SDK?: string;
  Street?: string;
  HouseNumber?: string;
  Floor?: string;
  AddressLine5?: string;
  StreetPostalCode?: string;
}

export const CustomerLookupQuerySchema = z.object({
  tipoDocumento: z.enum(["DNI", "CE", "RUC"]),
  numeroDocumento: z.string().min(1),
});
```

- [ ] **Step 2: Crear el helper de dirección compartido**

`packages/backend/src/domain/customerLookup/address.ts`:

```ts
import type { Address } from "@cerocontacto/shared";
import type { AddressSubRecord } from "./types.js";

/**
 * Convierte la fila cruda de IndividualCustomerAddress/CorporateAccountAddress
 * a un `Partial<Address>` - solo incluye los campos que C4C tenga registrados,
 * para que el frontend deje vacio lo que falte en vez de pisarlo con "".
 */
export function buildDireccion(address: AddressSubRecord | undefined): Partial<Address> {
  if (!address) return {};
  const direccion: Partial<Address> = {};
  if (address.StateCode) direccion.departamento = address.StateCode;
  if (address.zIDProvinciacontent_SDK) direccion.provincia = address.zIDProvinciacontent_SDK;
  if (address.zIDDistritocontent_SDK) direccion.distrito = address.zIDDistritocontent_SDK;
  if (address.Street) direccion.direccion = address.Street;
  if (address.HouseNumber) direccion.numero = address.HouseNumber;
  if (address.Floor) direccion.piso = address.Floor;
  if (address.AddressLine5) direccion.referencia = address.AddressLine5;
  if (address.StreetPostalCode) direccion.codigoPostal = address.StreetPostalCode;
  return direccion;
}
```

- [ ] **Step 3: Escribir el test que falla para `lookupIndividual`**

`packages/backend/src/domain/customerLookup/customerLookup.test.ts`:

```ts
import type { IC4CODataClient } from "@cerocontacto/c4c-client";
import { describe, expect, it, vi } from "vitest";
import { lookupIndividual } from "./individual.js";

function mockClient(overrides: Partial<IC4CODataClient> = {}): IC4CODataClient {
  return {
    getCollection: vi.fn().mockResolvedValue([]),
    postEntity: vi.fn(),
    patch: vi.fn(),
    ...overrides,
  };
}

describe("lookupIndividual", () => {
  it("cliente encontrado con direccion completa: devuelve found:true y todos los datos", async () => {
    const getCollection = vi
      .fn()
      .mockResolvedValueOnce([{ ParentObjectID: "OBJ1", CustomerID: "1035063" }])
      .mockResolvedValueOnce([{ ObjectID: "OBJ1", CustomerID: "1035063", FirstName: "ALVARO", LastName: "SEBASTIANI", Phone: "+51942568111", Email: "cliente@example.com" }])
      .mockResolvedValueOnce([
        {
          StateCode: "15",
          zIDProvinciacontent_SDK: "128",
          zIDDistritocontent_SDK: "1254",
          Street: "AV. EL SOL",
          HouseNumber: "555",
          AddressLine5: "Frente al parque",
          StreetPostalCode: "07021",
        },
      ]);
    const client = mockClient({ getCollection });

    const result = await lookupIndividual("DNI", "15619884", client);

    expect(result).toEqual({
      found: true,
      datos: {
        nombres: "ALVARO",
        apellidos: "SEBASTIANI",
        telefono: "+51942568111",
        email: "cliente@example.com",
        direccion: {
          departamento: "15",
          provincia: "128",
          distrito: "1254",
          direccion: "AV. EL SOL",
          numero: "555",
          referencia: "Frente al parque",
          codigoPostal: "07021",
        },
      },
    });
    expect(client.postEntity).not.toHaveBeenCalled();
  });

  it("cliente encontrado sin direccion registrada: datos.direccion queda vacio", async () => {
    const getCollection = vi
      .fn()
      .mockResolvedValueOnce([{ ParentObjectID: "OBJ2", CustomerID: "1035064" }])
      .mockResolvedValueOnce([{ ObjectID: "OBJ2", CustomerID: "1035064", FirstName: "JUAN", LastName: "PEREZ", Phone: "+51999999999", Email: "juan@example.com" }])
      .mockResolvedValueOnce([]);
    const client = mockClient({ getCollection });

    const result = await lookupIndividual("DNI", "20000001", client);

    expect(result.found).toBe(true);
    expect(result.datos?.direccion).toEqual({});
  });

  it("cliente no encontrado: devuelve found:false sin consultar mas nada", async () => {
    const getCollection = vi.fn().mockResolvedValueOnce([]);
    const client = mockClient({ getCollection });

    const result = await lookupIndividual("DNI", "99999999", client);

    expect(result).toEqual({ found: false });
    expect(getCollection).toHaveBeenCalledTimes(1);
  });

  it("CE usa TaxTypeCode '5' en el filtro (igual que customerResolution)", async () => {
    const getCollection = vi.fn().mockResolvedValueOnce([]);
    const client = mockClient({ getCollection });

    await lookupIndividual("CE", "AB123456", client);

    const filterUrl = (getCollection.mock.calls[0] as [string])[0];
    expect(decodeURIComponent(filterUrl)).toContain("TaxTypeCode eq '5'");
  });
});
```

- [ ] **Step 4: Correr el test para verificar que falla**

Run: `npm test --workspace=packages/backend -- customerLookup`
Expected: FAIL — `Cannot find module './individual.js'` (todavia no existe).

- [ ] **Step 5: Implementar `lookupIndividual`**

`packages/backend/src/domain/customerLookup/individual.ts`:

```ts
import type { IC4CODataClient } from "@cerocontacto/c4c-client";
import { and, eq } from "@cerocontacto/c4c-client";
import { INDIVIDUAL_TAX_TYPE_CODE } from "../customerResolution/types.js";
import { buildDireccion } from "./address.js";
import type {
  AddressSubRecord,
  CustomerLookupResult,
  IndividualCustomerLookupRecord,
  TaxNumberLookupRecord,
} from "./types.js";

const NS = "v1/c4codataapi";

/**
 * Busqueda de solo lectura por documento (DNI/CE) - a diferencia de
 * customerResolution/individual.ts, NUNCA crea un cliente si no lo
 * encuentra. Pensada para autocompletar el formulario en el evento
 * `blur` del campo de documento, antes de que el cliente termine de
 * llenar el resto de los datos.
 */
export async function lookupIndividual(
  tipoDocumento: "DNI" | "CE",
  numeroDocumento: string,
  client: IC4CODataClient,
): Promise<CustomerLookupResult> {
  const taxTypeCode = INDIVIDUAL_TAX_TYPE_CODE[tipoDocumento];
  const filter = and(eq("TaxID", numeroDocumento), eq("TaxTypeCode", taxTypeCode), eq("CountryCode", "PE"));
  const taxMatches = await client.getCollection<TaxNumberLookupRecord>(
    `${NS}/IndividualCustomerTaxNumberCollection?$filter=${encodeURIComponent(filter)}`,
  );

  const taxMatch = taxMatches[0];
  if (!taxMatch) return { found: false };

  const customers = await client.getCollection<IndividualCustomerLookupRecord>(
    `${NS}/IndividualCustomerCollection?$filter=${encodeURIComponent(eq("CustomerID", taxMatch.CustomerID ?? ""))}`,
  );
  const customer = customers[0];
  if (!customer) return { found: false };

  const addresses = await client.getCollection<AddressSubRecord>(
    `${NS}/IndividualCustomerCollection('${taxMatch.ParentObjectID}')/IndividualCustomerAddress`,
  );

  return {
    found: true,
    datos: {
      ...(customer.FirstName ? { nombres: customer.FirstName } : {}),
      ...(customer.LastName ? { apellidos: customer.LastName } : {}),
      telefono: customer.Phone ?? "",
      email: customer.Email ?? "",
      direccion: buildDireccion(addresses[0]),
    },
  };
}
```

- [ ] **Step 6: Correr el test para verificar que pasa**

Run: `npm test --workspace=packages/backend -- customerLookup`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/domain/customerLookup/types.ts packages/backend/src/domain/customerLookup/address.ts packages/backend/src/domain/customerLookup/individual.ts packages/backend/src/domain/customerLookup/customerLookup.test.ts
git commit -m "Agregar lookupIndividual: busqueda de solo lectura de cliente por DNI/CE"
```

---

### Task 2: `lookupEmpresa` (RUC) + dispatcher `lookupCustomer`, TDD

**Files:**
- Create: `packages/backend/src/domain/customerLookup/empresa.ts`
- Create: `packages/backend/src/domain/customerLookup/index.ts`
- Modify: `packages/backend/src/domain/customerLookup/customerLookup.test.ts`

**Interfaces:**
- Consumes: mismo `IC4CODataClient`/`and`/`eq` de Task 1; `buildDireccion` de `./address.js`; `CorporateAccountLookupRecord`, `TaxNumberLookupRecord`, `CustomerLookupResult` de `./types.js`; `lookupIndividual` de `./individual.js` (Task 1).
- Produces: `lookupEmpresa(numeroDocumento: string, client: IC4CODataClient): Promise<CustomerLookupResult>`, `lookupCustomer(tipoDocumento: "DNI" | "CE" | "RUC", numeroDocumento: string, client: IC4CODataClient): Promise<CustomerLookupResult>` (usado por Task 4, el endpoint).

- [ ] **Step 1: Agregar los tests que fallan (empresa + dispatcher)**

Agregar al final de `packages/backend/src/domain/customerLookup/customerLookup.test.ts` (mismo archivo de Task 1):

```ts
import { lookupCustomer } from "./index.js";
import { lookupEmpresa } from "./empresa.js";

describe("lookupEmpresa", () => {
  it("empresa encontrada: devuelve found:true con razonSocial", async () => {
    const getCollection = vi
      .fn()
      .mockResolvedValueOnce([{ ParentObjectID: "OBJ1", AccountID: "1038018" }])
      .mockResolvedValueOnce([{ ObjectID: "OBJ1", AccountID: "1038018", Name: "SERVICIOS MEDICOS M'VAPE S.A.C.", Phone: "+51942568111", Email: "empresa@example.com" }])
      .mockResolvedValueOnce([{ StateCode: "15", StreetPostalCode: "07001" }]);
    const client = mockClient({ getCollection });

    const result = await lookupEmpresa("20525512348", client);

    expect(result.found).toBe(true);
    expect(result.datos?.razonSocial).toBe("SERVICIOS MEDICOS M'VAPE S.A.C.");
    expect(result.datos?.direccion).toEqual({ departamento: "15", codigoPostal: "07001" });
    expect(client.postEntity).not.toHaveBeenCalled();
  });

  it("empresa no encontrada: devuelve found:false", async () => {
    const client = mockClient({ getCollection: vi.fn().mockResolvedValueOnce([]) });

    const result = await lookupEmpresa("20999999999", client);

    expect(result).toEqual({ found: false });
  });
});

describe("lookupCustomer (dispatcher)", () => {
  it("RUC despacha a lookupEmpresa", async () => {
    const client = mockClient({ getCollection: vi.fn().mockResolvedValueOnce([]) });
    const result = await lookupCustomer("RUC", "20525512348", client);
    expect(result).toEqual({ found: false });
  });

  it("DNI despacha a lookupIndividual", async () => {
    const client = mockClient({ getCollection: vi.fn().mockResolvedValueOnce([]) });
    const result = await lookupCustomer("DNI", "15619884", client);
    expect(result).toEqual({ found: false });
  });
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `npm test --workspace=packages/backend -- customerLookup`
Expected: FAIL — `Cannot find module './empresa.js'` / `'./index.js'`.

- [ ] **Step 3: Implementar `lookupEmpresa`**

`packages/backend/src/domain/customerLookup/empresa.ts`:

```ts
import type { IC4CODataClient } from "@cerocontacto/c4c-client";
import { and, eq } from "@cerocontacto/c4c-client";
import { buildDireccion } from "./address.js";
import type { AddressSubRecord, CorporateAccountLookupRecord, CustomerLookupResult, TaxNumberLookupRecord } from "./types.js";

const NS = "v1/c4codataapi";

/**
 * Busqueda de solo lectura por RUC - a diferencia de
 * customerResolution/empresa.ts, NUNCA crea una cuenta si no la encuentra.
 */
export async function lookupEmpresa(numeroDocumento: string, client: IC4CODataClient): Promise<CustomerLookupResult> {
  const filter = and(eq("TaxID", numeroDocumento), eq("TaxTypeCode", "1"), eq("CountryCode", "PE"));
  const taxMatches = await client.getCollection<TaxNumberLookupRecord>(
    `${NS}/CorporateAccountTaxNumberCollection?$filter=${encodeURIComponent(filter)}`,
  );

  const taxMatch = taxMatches[0];
  if (!taxMatch) return { found: false };

  const accounts = await client.getCollection<CorporateAccountLookupRecord>(
    `${NS}/CorporateAccountCollection?$filter=${encodeURIComponent(eq("AccountID", taxMatch.AccountID ?? ""))}`,
  );
  const account = accounts[0];
  if (!account) return { found: false };

  const addresses = await client.getCollection<AddressSubRecord>(
    `${NS}/CorporateAccountCollection('${taxMatch.ParentObjectID}')/CorporateAccountAddress`,
  );

  return {
    found: true,
    datos: {
      ...(account.Name ? { razonSocial: account.Name } : {}),
      telefono: account.Phone ?? "",
      email: account.Email ?? "",
      direccion: buildDireccion(addresses[0]),
    },
  };
}
```

- [ ] **Step 4: Implementar el dispatcher `lookupCustomer`**

`packages/backend/src/domain/customerLookup/index.ts`:

```ts
import type { IC4CODataClient } from "@cerocontacto/c4c-client";
import { lookupEmpresa } from "./empresa.js";
import { lookupIndividual } from "./individual.js";
import type { CustomerLookupResult } from "./types.js";

export * from "./types.js";

export async function lookupCustomer(
  tipoDocumento: "DNI" | "CE" | "RUC",
  numeroDocumento: string,
  client: IC4CODataClient,
): Promise<CustomerLookupResult> {
  return tipoDocumento === "RUC" ? lookupEmpresa(numeroDocumento, client) : lookupIndividual(tipoDocumento, numeroDocumento, client);
}
```

- [ ] **Step 5: Correr los tests para verificar que pasan**

Run: `npm test --workspace=packages/backend -- customerLookup`
Expected: PASS (8 tests en total: 4 de Task 1 + 4 de este task).

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/domain/customerLookup/empresa.ts packages/backend/src/domain/customerLookup/index.ts packages/backend/src/domain/customerLookup/customerLookup.test.ts
git commit -m "Agregar lookupEmpresa y dispatcher lookupCustomer"
```

---

### Task 3: Rate limiter en memoria, TDD

**Files:**
- Create: `packages/backend/src/infra/rateLimiter.ts`
- Test: `packages/backend/src/infra/rateLimiter.test.ts`

**Interfaces:**
- Consumes: tipos `Request`, `Response`, `NextFunction` de `express`.
- Produces: `createRateLimiter(options: { windowMs: number; max: number }): (req: Request, res: Response, next: NextFunction) => void` (usado por Task 4).

- [ ] **Step 1: Escribir los tests que fallan**

`packages/backend/src/infra/rateLimiter.test.ts`:

```ts
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
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `npm test --workspace=packages/backend -- rateLimiter`
Expected: FAIL — `Cannot find module './rateLimiter.js'`.

- [ ] **Step 3: Implementar `createRateLimiter`**

`packages/backend/src/infra/rateLimiter.ts`:

```ts
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
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `npm test --workspace=packages/backend -- rateLimiter`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/infra/rateLimiter.ts packages/backend/src/infra/rateLimiter.test.ts
git commit -m "Agregar rate limiter en memoria por IP"
```

---

### Task 4: Endpoint `GET /api/clientes/lookup`

**Files:**
- Modify: `packages/backend/src/app.ts`
- Modify: `packages/backend/src/app.test.ts`

**Interfaces:**
- Consumes: `lookupCustomer`, `CustomerLookupQuerySchema` de `./domain/customerLookup/index.js` (Task 1+2); `createRateLimiter` de `./infra/rateLimiter.js` (Task 3); `buildC4CClientFromEnv` de `./config.js` (ya existe).
- Produces: ruta `GET /api/clientes/lookup?tipoDocumento=...&numeroDocumento=...` (usada por Task 5, el cliente del frontend).

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `packages/backend/src/app.test.ts`, después de los mocks existentes (antes de `import { createApp } from "./app.js";`):

```ts
const { mockLookupCustomer } = vi.hoisted(() => ({ mockLookupCustomer: vi.fn() }));

vi.mock("./domain/customerLookup/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./domain/customerLookup/index.js")>();
  return { ...actual, lookupCustomer: mockLookupCustomer };
});
```

Y agregar estos tests dentro del `describe("createApp", ...)` existente, junto a los de `/api/fechas-disponibles` (recordar también agregar `mockLookupCustomer.mockReset();` al `afterEach` existente):

```ts
it("GET /api/clientes/lookup con cliente encontrado devuelve found:true", async () => {
  mockLookupCustomer.mockResolvedValue({
    found: true,
    datos: { nombres: "ALVARO", apellidos: "SEBASTIANI", telefono: "+51942568111", email: "cliente@example.com", direccion: {} },
  });

  const res = await request(createApp()).get("/api/clientes/lookup?tipoDocumento=DNI&numeroDocumento=15619884");

  expect(res.status).toBe(200);
  expect(res.body.found).toBe(true);
  expect(mockLookupCustomer).toHaveBeenCalledWith("DNI", "15619884", expect.anything());
});

it("GET /api/clientes/lookup sin cliente encontrado devuelve found:false", async () => {
  mockLookupCustomer.mockResolvedValue({ found: false });

  const res = await request(createApp()).get("/api/clientes/lookup?tipoDocumento=DNI&numeroDocumento=99999999");

  expect(res.status).toBe(200);
  expect(res.body).toEqual({ found: false });
});

it("GET /api/clientes/lookup con tipoDocumento invalido devuelve 400 sin llamar a C4C", async () => {
  const res = await request(createApp()).get("/api/clientes/lookup?tipoDocumento=PASAPORTE&numeroDocumento=123");

  expect(res.status).toBe(400);
  expect(mockLookupCustomer).not.toHaveBeenCalled();
});

it("GET /api/clientes/lookup responde 429 tras superar el limite de 10 solicitudes por minuto de la misma IP", async () => {
  mockLookupCustomer.mockResolvedValue({ found: false });
  const app = createApp();

  for (let i = 0; i < 10; i++) {
    const res = await request(app).get("/api/clientes/lookup?tipoDocumento=DNI&numeroDocumento=15619884");
    expect(res.status).toBe(200);
  }
  const res = await request(app).get("/api/clientes/lookup?tipoDocumento=DNI&numeroDocumento=15619884");
  expect(res.status).toBe(429);
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `npm test --workspace=packages/backend -- app.test`
Expected: FAIL — 404 en vez de 200/400/429 (la ruta no existe todavia).

- [ ] **Step 3: Agregar la ruta en `app.ts`**

En `packages/backend/src/app.ts`, agregar los imports (junto a los existentes, línea 3-6):

```ts
import { lookupCustomer, CustomerLookupQuerySchema } from "./domain/customerLookup/index.js";
import { createRateLimiter } from "./infra/rateLimiter.js";
```

Dentro de `createApp()`, antes del `return app;` final, agregar:

```ts
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
```

(Colocar esta ruta después de la de `/api/fechas-disponibles` y antes del middleware de manejo de errores de JSON.)

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `npm test --workspace=packages/backend -- app.test`
Expected: PASS (todos los tests de `app.test.ts`, incluidos los 4 nuevos).

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/app.ts packages/backend/src/app.test.ts
git commit -m "Agregar endpoint GET /api/clientes/lookup con rate limit"
```

---

### Task 5: Cliente del frontend (`api.ts`)

**Files:**
- Modify: `packages/frontend/src/api.ts`

**Interfaces:**
- Consumes: `Address` de `@cerocontacto/shared`; `ApiError` (ya definida en el mismo archivo).
- Produces: `lookupCustomer(tipoDocumento: "DNI" | "CE" | "RUC", numeroDocumento: string): Promise<CustomerLookupResult>`, tipos `CustomerLookupData`/`CustomerLookupResult` (usados por Task 6).

No hay suite de tests de frontend en este proyecto (confirmado en la spec) — este paso no lleva TDD, sigue el mismo patrón que `searchProducts`/`getFechasDisponibles` ya existentes en el mismo archivo.

- [ ] **Step 1: Agregar el import de `Address`**

En `packages/frontend/src/api.ts`, cambiar la primera línea:

```ts
import type { Address, ServiceRequestSubmission } from "@cerocontacto/shared";
```

- [ ] **Step 2: Agregar los tipos y la función, al final del archivo**

```ts
export interface CustomerLookupData {
  nombres?: string;
  apellidos?: string;
  razonSocial?: string;
  telefono: string;
  email: string;
  direccion: Partial<Address>;
}

export interface CustomerLookupResult {
  found: boolean;
  datos?: CustomerLookupData;
}

/**
 * Busca si el cliente ya existe en C4C por su documento, para autocompletar
 * el formulario. Nunca lanza por "no encontrado" (found:false es un
 * resultado valido) - solo por error real de red/servidor, y el caller
 * decide ignorarlo en silencio.
 */
export async function lookupCustomer(
  tipoDocumento: "DNI" | "CE" | "RUC",
  numeroDocumento: string,
): Promise<CustomerLookupResult> {
  const params = new URLSearchParams({ tipoDocumento, numeroDocumento });
  const res = await fetch(`/api/clientes/lookup?${params.toString()}`);
  if (!res.ok) {
    throw new ApiError("No pudimos buscar tus datos.");
  }
  const body = (await res.json().catch(() => undefined)) as CustomerLookupResult | undefined;
  return body ?? { found: false };
}
```

- [ ] **Step 3: Verificar que compila**

Run: `npm run typecheck --workspace=packages/frontend`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/api.ts
git commit -m "Agregar cliente lookupCustomer al frontend"
```

---

### Task 6: Autocompletado en `App.tsx`

**Files:**
- Modify: `packages/frontend/src/App.tsx`

**Interfaces:**
- Consumes: `lookupCustomer`, `CustomerLookupData` de `./api.js` (Task 5); `isValidDni`, `isValidCe`, `isValidRuc` de `@cerocontacto/shared`.

- [ ] **Step 1: Agregar los imports nuevos**

En `packages/frontend/src/App.tsx`, ampliar el import de `@cerocontacto/shared` (línea 3-4) y el de `./api.js` (línea 5):

```ts
import { ServiceRequestSubmissionSchema, isValidCe, isValidDni, isValidRuc } from "@cerocontacto/shared";
import { PERU_DISTRITOS } from "@cerocontacto/shared";
import { ApiError, lookupCustomer, submitServiceRequest, type SubmitResult } from "./api.js";
```

- [ ] **Step 2: Agregar estado y helpers dentro de `App()`**

Después de la línea `const [step, setStep] = useState(1);` (línea 181), agregar:

```ts
  const [customerLookupStatus, setCustomerLookupStatus] = useState<"idle" | "loading" | "found">("idle");
  const [lookedUpDocumento, setLookedUpDocumento] = useState<string | null>(null);

  const DOCUMENT_VALIDATORS: Record<FormState["tipoDocumento"], (v: string) => boolean> = {
    DNI: isValidDni,
    CE: isValidCe,
    RUC: isValidRuc,
  };

  function clearAutofilledFields() {
    setForm((prev) => ({
      ...prev,
      nombres: "",
      apellidos: "",
      razonSocial: "",
      telefono: "",
      email: "",
      departamento: "",
      provincia: "",
      distrito: "",
      direccion: "",
      numero: "",
      piso: "",
      referencia: "",
      codigoPostal: "",
    }));
  }

  async function handleDocumentoBlur() {
    const numeroDocumento = form.numeroDocumento.trim();
    if (!DOCUMENT_VALIDATORS[form.tipoDocumento](numeroDocumento)) return;

    setCustomerLookupStatus("loading");
    try {
      const result = await lookupCustomer(form.tipoDocumento, numeroDocumento);
      if (!result.found || !result.datos) {
        setCustomerLookupStatus("idle");
        return;
      }
      const d = result.datos;
      setForm((prev) => ({
        ...prev,
        ...(d.nombres ? { nombres: d.nombres } : {}),
        ...(d.apellidos ? { apellidos: d.apellidos } : {}),
        ...(d.razonSocial ? { razonSocial: d.razonSocial } : {}),
        ...(d.telefono ? { telefono: d.telefono } : {}),
        ...(d.email ? { email: d.email } : {}),
        ...(d.direccion.departamento ? { departamento: d.direccion.departamento } : {}),
        ...(d.direccion.provincia ? { provincia: d.direccion.provincia } : {}),
        ...(d.direccion.distrito ? { distrito: d.direccion.distrito } : {}),
        ...(d.direccion.direccion ? { direccion: d.direccion.direccion } : {}),
        ...(d.direccion.numero ? { numero: d.direccion.numero } : {}),
        ...(d.direccion.piso ? { piso: d.direccion.piso } : {}),
        ...(d.direccion.referencia ? { referencia: d.direccion.referencia } : {}),
        ...(d.direccion.codigoPostal ? { codigoPostal: d.direccion.codigoPostal } : {}),
      }));
      setLookedUpDocumento(numeroDocumento);
      setCustomerLookupStatus("found");
    } catch (err) {
      console.error("customer_lookup_failed", err);
      setCustomerLookupStatus("idle");
    }
  }

  function handleDocumentoChange(value: string) {
    if (lookedUpDocumento !== null && value !== lookedUpDocumento) {
      clearAutofilledFields();
      setLookedUpDocumento(null);
      setCustomerLookupStatus("idle");
    }
    update("numeroDocumento", value);
  }
```

- [ ] **Step 3: Conectar el campo "Número de documento" al nuevo handler**

En el mismo archivo, reemplazar el bloque del campo `numeroDocumento` (líneas 317-326):

```tsx
            <div className="field">
              <label htmlFor="numeroDocumento">Número de documento</label>
              <input
                id="numeroDocumento"
                type="text"
                value={form.numeroDocumento}
                onChange={(e) => handleDocumentoChange(e.target.value)}
                onBlur={handleDocumentoBlur}
              />
              <FieldError message={fieldErrors.numeroDocumento} />
              {customerLookupStatus === "loading" && <p className="hint">Buscando...</p>}
              {customerLookupStatus === "found" && <p className="hint">Datos encontrados, puedes corregirlos si cambiaron.</p>}
            </div>
```

- [ ] **Step 4: Verificar que compila**

Run: `npm run typecheck --workspace=packages/frontend`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/App.tsx
git commit -m "Autocompletar datos personales y direccion cuando el cliente ya existe"
```

---

### Task 7: Verificación completa

**Files:** ninguno (solo verificación).

- [ ] **Step 1: Typecheck de todo el monorepo**

Run: `npm run typecheck --workspaces`
Expected: sin errores en `shared`, `c4c-client`, `backend`, `frontend`.

- [ ] **Step 2: Tests de todo el monorepo**

Run: `npm test --workspaces`
Expected: todos los tests pasan (los existentes + los ~16 nuevos de `customerLookup.test.ts`, `rateLimiter.test.ts` y `app.test.ts`).

- [ ] **Step 3: Build del backend y arranque local**

Run:
```bash
npm run build --workspace=packages/shared
npm run build --workspace=packages/c4c-client
npm run build --workspace=packages/backend
node packages/backend/dist/server.js
```
Expected: el servidor arranca sin errores en el puerto configurado (usar `.env.local`, mismas credenciales de producción `_CEROCONTACT` ya configuradas).

- [ ] **Step 4: Verificación manual en el navegador — caso "no encontrado"**

Con el backend local corriendo y el frontend en modo dev (`npm run dev --workspace=packages/frontend`), abrir el formulario, escribir un DNI que casi seguro no existe en C4C (ej. `00000001`) y salir del campo. Confirmar: aparece brevemente "Buscando...", luego no pasa nada visible (sin autofill, sin error), el formulario sigue usable.

- [ ] **Step 5: Verificación manual en el navegador — caso "encontrado" (opcional, requiere un documento real ya registrado en C4C)**

Si el usuario tiene a mano el DNI/RUC de un cliente que ya compró antes (por ejemplo, uno de los documentos de prueba usados en sesiones anteriores contra QA/producción), escribirlo y salir del campo. Confirmar: aparece "Buscando...", luego se autocompletan nombre/apellidos, teléfono, email y dirección (los que C4C tenga), aparece el mensaje "Datos encontrados...", y los campos siguen siendo editables. Cambiar el número de documento después y confirmar que los campos autocompletados se limpian.

- [ ] **Step 6: Confirmar con el usuario y hacer push**

Mostrar el resultado de la verificación al usuario. Si todo está bien, preguntar si quiere hacer `git push origin master` (no hacerlo sin confirmación explícita, siguiendo el patrón ya establecido en este proyecto).
